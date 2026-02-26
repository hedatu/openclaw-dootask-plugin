#!/usr/bin/env node

/**
 * OpenClaw DooTask Plugin (简化版)
 * 使用 OpenClaw CLI 命令处理消息
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

// 配置
const CONFIG = {
  dootask: {
    apiUrl: process.env.DOOTASK_API_URL || 'http://192.168.1.67:2222',
    botToken: process.env.DOOTASK_BOT_TOKEN || '',
    version: '1.2.11'
  },
  webhook: {
    port: process.env.WEBHOOK_PORT || 3000,
    path: '/webhook'
  }
};

// 消息处理队列
const messageQueue = new Map(); // dialog_id -> processing flag

/**
 * 调用 OpenClaw CLI 处理消息
 */
async function callOpenClawCLI(message, sessionId) {
  return new Promise((resolve, reject) => {
    console.log('[OpenClaw] 调用 CLI:', message);
    
    // 直接调用 openclaw，因为服务本身以 tmt8 用户运行
    // HOME 环境变量已在 LaunchAgent 中设置
    const args = [
      'agent',
      '--message', message,
      '--session-id', sessionId
    ];
    
    const openclaw = spawn('openclaw', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: '/Users/tmt8'
      }
    });
    
    // 设置 2 分钟超时
    const timeout = setTimeout(() => {
      openclaw.kill();
      reject(new Error('OpenClaw CLI timeout after 120s'));
    }, 120000);
    
    let stdout = '';
    let stderr = '';
    
    openclaw.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    openclaw.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    openclaw.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const response = stdout.trim();
        console.log('[OpenClaw] CLI 响应:', response.substring(0, 200) + '...');
        resolve(response);
      } else {
        console.error('[OpenClaw] CLI 错误:', stderr);
        reject(new Error(`OpenClaw CLI exited with code ${code}`));
      }
    });
    
    openclaw.on('error', (error) => {
      clearTimeout(timeout);
      console.error('[OpenClaw] CLI 启动失败:', error);
      reject(error);
    });
  });
}

/**
 * 发送消息到 DooTask
 */
async function sendToDooTask(dialogId, text) {
  const url = `${CONFIG.dootask.apiUrl}/api/dialog/msg/sendtext`;
  
  const payload = JSON.stringify({
    dialog_id: dialogId,
    text: text,
    text_type: 'md'
  });
  
  console.log('[DooTask] 发送消息:', { dialogId, textLength: text.length, text: text.substring(0, 100) + '...' });
  
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
        'version': CONFIG.dootask.version,
        'token': CONFIG.dootask.botToken
      }
    };
    
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[DooTask] 发送成功');
          resolve(data);
        } else {
          console.error('[DooTask] 发送失败:', res.statusCode, data);
          reject(new Error(`DooTask API error: ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('[DooTask] 请求失败:', error);
      reject(error);
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * 处理来自 DooTask 的消息
 */
async function handleDooTaskMessage(message) {
  const { text, dialog_id, msg_id, msg_uid, bot_uid } = message;
  
  console.log('[Webhook] 收到 DooTask 消息:', { text, dialog_id, msg_id });
  
  // 忽略机器人自己的消息
  if (msg_uid === bot_uid) {
    console.log('[Webhook] 忽略机器人自己的消息');
    return;
  }
  
  // 检查是否正在处理该对话
  if (messageQueue.get(dialog_id)) {
    console.log('[Webhook] 对话正在处理中，跳过');
    return;
  }
  
  messageQueue.set(dialog_id, true);
  
  try {
    // 调用 OpenClaw CLI，使用简单的 session_id（移除特殊字符）
    const sessionId = `dootask${dialog_id}`;
    const response = await callOpenClawCLI(text, sessionId);
    
    // 发送回复到 DooTask
    if (response) {
      await sendToDooTask(dialog_id, response);
    }
  } catch (error) {
    console.error('[处理] 失败:', error);
    // 发送错误消息
    await sendToDooTask(dialog_id, '抱歉，处理消息时出错了。');
  } finally {
    messageQueue.delete(dialog_id);
  }
}

/**
 * 创建 Webhook 服务器
 */
function createWebhookServer() {
  const server = http.createServer((req, res) => {
    // 处理 Webhook 请求
    if (req.method === 'POST' && req.url === CONFIG.webhook.path) {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          let message;
          
          // 检查 Content-Type
          const contentType = req.headers['content-type'] || '';
          
          if (contentType.includes('application/x-www-form-urlencoded')) {
            // URL 编码格式
            const params = new URLSearchParams(body);
            message = {};
            for (const [key, value] of params) {
              message[key] = value;
            }
          } else {
            // JSON 格式
            message = JSON.parse(body);
          }
          
          // 异步处理消息
          handleDooTaskMessage(message).catch(error => {
            console.error('[Webhook] 处理消息失败:', error);
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (error) {
          console.error('[Webhook] 解析请求失败:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      
      return;
    }
    
    // 健康检查
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', plugin: 'dootask' }));
      return;
    }
    
    // 404
    res.writeHead(404);
    res.end('Not Found');
  });
  
  server.listen(CONFIG.webhook.port, () => {
    console.log('=== OpenClaw DooTask Plugin ===');
    console.log('配置信息:');
    console.log('- DooTask API:', CONFIG.dootask.apiUrl);
    console.log('- Webhook 端口:', CONFIG.webhook.port);
    console.log('================================');
    console.log('[Webhook] 服务器已启动: http://localhost:' + CONFIG.webhook.port + CONFIG.webhook.path);
    console.log('[Webhook] 请在 DooTask 机器人配置中设置此 URL 为 Webhook 地址');
  });
  
  return server;
}

// 启动服务器
const server = createWebhookServer();

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[Plugin] 正在关闭...');
  server.close(() => {
    console.log('[Plugin] 已关闭');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[Plugin] 正在关闭...');
  server.close(() => {
    console.log('[Plugin] 已关闭');
    process.exit(0);
  });
});
