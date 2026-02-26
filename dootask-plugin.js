#!/usr/bin/env node

/**
 * OpenClaw DooTask Plugin
 * Stable version: webhook + per-dialog queue + dedupe + resilient retries
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const index = line.indexOf('=');
      if (index < 1) {
        continue;
      }
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.error('[Env] failed to load .env:', error.message || error);
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const NODE_BIN_DIR = '/Users/tmt8/.nvm/versions/node/v24.13.1/bin';

const CONFIG = {
  dootask: {
    apiUrl: process.env.DOOTASK_API_URL || 'http://192.168.1.67:2222',
    botToken: process.env.DOOTASK_BOT_TOKEN || '',
    version: process.env.DOOTASK_VERSION || '1.2.11'
  },
  webhook: {
    port: Number(process.env.WEBHOOK_PORT || 3000),
    path: process.env.WEBHOOK_PATH || '/webhook',
    maxBodyBytes: Number(process.env.WEBHOOK_MAX_BODY || 2 * 1024 * 1024)
  },
  openclaw: {
    bin: process.env.OPENCLAW_BIN || path.join(NODE_BIN_DIR, 'openclaw'),
    home: process.env.OPENCLAW_HOME || '/Users/tmt8',
    timeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS || 180000),
    attempts: Number(process.env.OPENCLAW_ATTEMPTS || 2),
    retryDelayMs: Number(process.env.OPENCLAW_RETRY_DELAY_MS || 1200),
    recoverySuffix: process.env.OPENCLAW_RECOVERY_SUFFIX || '-recovery'
  },
  dedupe: {
    ttlMs: Number(process.env.MSG_DEDUPE_TTL_MS || 5 * 60 * 1000)
  }
};

if (!CONFIG.dootask.botToken) {
  console.error('[Config] DOOTASK_BOT_TOKEN is empty. Check .env or launch environment.');
  process.exit(1);
}

// dialog_id -> Promise chain: serialize requests per dialog
const dialogQueues = new Map();
// msg_id -> timestamp: avoid duplicate replies from retries
const recentMsgIds = new Map();

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupRecentMsgIds() {
  const expireBefore = now() - CONFIG.dedupe.ttlMs;
  for (const [msgId, ts] of recentMsgIds.entries()) {
    if (ts < expireBefore) {
      recentMsgIds.delete(msgId);
    }
  }
}

const dedupeTimer = setInterval(cleanupRecentMsgIds, 60 * 1000);
if (typeof dedupeTimer.unref === 'function') {
  dedupeTimer.unref();
}

function isDuplicate(msgId) {
  if (!msgId) {
    return false;
  }
  cleanupRecentMsgIds();
  if (recentMsgIds.has(msgId)) {
    return true;
  }
  recentMsgIds.set(msgId, now());
  return false;
}

function enqueueByDialog(dialogId, task) {
  const key = String(dialogId);
  const prev = dialogQueues.get(key) || Promise.resolve();

  const next = prev
    .catch(() => {
      // swallow previous error and keep queue alive
    })
    .then(task)
    .catch((error) => {
      console.error('[Queue] task failed:', error);
    });

  dialogQueues.set(
    key,
    next.finally(() => {
      if (dialogQueues.get(key) === next) {
        dialogQueues.delete(key);
      }
    })
  );
}

function normalizeMessage(raw) {
  const message = raw && typeof raw === 'object' ? raw : {};

  return {
    text: typeof message.text === 'string' ? message.text : '',
    dialog_id: message.dialog_id == null ? '' : String(message.dialog_id),
    msg_id: message.msg_id == null ? '' : String(message.msg_id),
    msg_uid: message.msg_uid == null ? '' : String(message.msg_uid),
    bot_uid: message.bot_uid == null ? '' : String(message.bot_uid)
  };
}

function shouldRetryOpenClawError(error) {
  const msg = String(error && error.message ? error.message : error || '').toLowerCase();
  return (
    msg.includes('connection error') ||
    msg.includes('timeout') ||
    msg.includes('gateway closed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('unknown model')
  );
}

async function callOpenClawCLI(message, sessionId) {
  return new Promise((resolve, reject) => {
    const args = ['agent', '--message', message, '--session-id', sessionId];

    console.log('[OpenClaw] CLI call:', {
      bin: CONFIG.openclaw.bin,
      sessionId,
      messageLength: message.length
    });

    const child = spawn(CONFIG.openclaw.bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: CONFIG.openclaw.home,
      env: {
        ...process.env,
        HOME: CONFIG.openclaw.home,
        PATH: `${path.dirname(CONFIG.openclaw.bin)}:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`
      }
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`OpenClaw CLI timeout after ${CONFIG.openclaw.timeoutMs}ms`));
    }, CONFIG.openclaw.timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const errPreview = stderr.trim().slice(0, 1000);
      reject(new Error(`OpenClaw CLI exited with code ${code}: ${errPreview}`));
    });
  });
}

async function runOpenClawWithResilience(text, dialogId) {
  const baseSessionId = `dootask${dialogId}`;
  let lastError = null;

  for (let attempt = 1; attempt <= CONFIG.openclaw.attempts; attempt++) {
    try {
      return await callOpenClawCLI(text, baseSessionId);
    } catch (error) {
      lastError = error;
      console.error(`[OpenClaw] attempt ${attempt}/${CONFIG.openclaw.attempts} failed:`, error.message || error);
      if (attempt < CONFIG.openclaw.attempts && shouldRetryOpenClawError(error)) {
        await sleep(CONFIG.openclaw.retryDelayMs);
        continue;
      }
      break;
    }
  }

  if (lastError && shouldRetryOpenClawError(lastError)) {
    const recoverySessionId = `${baseSessionId}${CONFIG.openclaw.recoverySuffix}`;
    console.log('[OpenClaw] trying recovery session:', recoverySessionId);
    try {
      return await callOpenClawCLI(text, recoverySessionId);
    } catch (recoveryError) {
      throw recoveryError;
    }
  }

  throw lastError || new Error('OpenClaw call failed');
}

async function sendToDooTask(dialogId, text) {
  const url = `${CONFIG.dootask.apiUrl}/api/dialog/msg/sendtext`;
  const payload = JSON.stringify({
    dialog_id: dialogId,
    text,
    text_type: 'md'
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        version: CONFIG.dootask.version,
        token: CONFIG.dootask.botToken
      }
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DooTask API http error ${res.statusCode}: ${data}`));
          return;
        }

        let parsed = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch (error) {
          reject(new Error(`DooTask API invalid JSON: ${data}`));
          return;
        }

        // dootask normal shape: {ret:1,msg:'发送成功',data:{...}}
        if (parsed.ret === 1 || parsed.code === 200) {
          resolve(parsed);
          return;
        }

        reject(new Error(`DooTask API business error: ${parsed.msg || data}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function processDooTaskMessage(rawMessage) {
  const message = normalizeMessage(rawMessage);
  const { text, dialog_id, msg_id, msg_uid, bot_uid } = message;

  console.log('[Webhook] got message:', {
    dialog_id,
    msg_id,
    textLength: text.length
  });

  if (!dialog_id) {
    console.log('[Webhook] skip: missing dialog_id');
    return;
  }

  if (!text.trim()) {
    console.log('[Webhook] skip: empty text');
    return;
  }

  if (msg_uid && bot_uid && msg_uid === bot_uid) {
    console.log('[Webhook] skip: bot self message');
    return;
  }

  if (isDuplicate(msg_id)) {
    console.log('[Webhook] skip: duplicate msg_id', msg_id);
    return;
  }

  try {
    const response = await runOpenClawWithResilience(text, dialog_id);
    const safeResponse = response && response.trim() ? response : '我收到了消息，但暂时没有可返回的内容。';
    await sendToDooTask(dialog_id, safeResponse);
    console.log('[DooTask] send ok:', { dialog_id, msg_id, responseLength: safeResponse.length });
  } catch (error) {
    console.error('[Process] failed:', error.message || error);
    try {
      await sendToDooTask(dialog_id, '抱歉，处理消息时出错了，请稍后重试。');
      console.log('[DooTask] fallback sent:', { dialog_id, msg_id });
    } catch (sendError) {
      console.error('[Process] failed to send fallback:', sendError.message || sendError);
    }
  }
}

function parseBody(req, body) {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    const message = {};
    for (const [key, value] of params.entries()) {
      message[key] = value;
    }
    return message;
  }

  return JSON.parse(body);
}

function createWebhookServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', plugin: 'dootask' }));
      return;
    }

    if (req.method === 'POST' && req.url === CONFIG.webhook.path) {
      let body = '';
      let bodySize = 0;

      req.on('data', (chunk) => {
        bodySize += chunk.length;
        if (bodySize > CONFIG.webhook.maxBodyBytes) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });

      req.on('end', () => {
        let message;
        try {
          message = parseBody(req, body);
        } catch (error) {
          console.error('[Webhook] parse failed:', error.message || error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
          return;
        }

        // ACK immediately, process asynchronously in per-dialog queue.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));

        const dialogId = message && message.dialog_id != null ? String(message.dialog_id) : '';
        if (!dialogId) {
          console.log('[Webhook] drop: no dialog_id');
          return;
        }

        enqueueByDialog(dialogId, () => processDooTaskMessage(message));
      });

      req.on('error', (error) => {
        console.error('[Webhook] request error:', error.message || error);
      });

      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (error) => {
    console.error('[Server] runtime error:', error);
    process.exit(1);
  });

  server.listen(CONFIG.webhook.port, () => {
    console.log('=== OpenClaw DooTask Plugin ===');
    console.log('Config:');
    console.log('- DooTask API:', CONFIG.dootask.apiUrl);
    console.log('- Bot Token Loaded:', CONFIG.dootask.botToken ? 'yes' : 'no');
    console.log('- Webhook URL:', `http://0.0.0.0:${CONFIG.webhook.port}${CONFIG.webhook.path}`);
    console.log('- OpenClaw Bin:', CONFIG.openclaw.bin);
    console.log('- OpenClaw Attempts:', CONFIG.openclaw.attempts);
    console.log('================================');
  });

  return server;
}

const server = createWebhookServer();

function shutdown(signal) {
  console.log(`\n[Plugin] received ${signal}, shutting down...`);
  server.close(() => {
    console.log('[Plugin] closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('[Plugin] uncaughtException:', error);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error('[Plugin] unhandledRejection:', error);
  process.exit(1);
});