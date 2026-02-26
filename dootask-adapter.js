#!/usr/bin/env node

/**
 * OpenClaw DooTask Plugin
 * 基于 Telegram 插件模式的 DooTask 插件
 */

const http = require('http');
const https = require('https');
const WebSocket = require('ws');

// 配置
const CONFIG = {
  // DooTask 配置
  dootask: {
    apiUrl: process.env.DOOTASK_API_URL || 'http://192.168.1.67:2222',
    botToken: process.env.DOOTASK_BOT_TOKEN || '',
    version: '1.2.11'
  },
  
  // Webhook 服务器配置
  webhook: {
    port: process.env.WEBHOOK_PORT || 3000,
    path: '/webhook'
  },
  
  // OpenClaw Gateway 配置
  openclaw: {
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:7878',
    token: process.env.OPENCLAW_TOKEN || ''
  }
};

// 全局状态
let wsClient = null;
let sessionMap = new Map(); // dialog_id -> session_id 映射

/**
 * 连接到 OpenClaw Gateway
 */
function connectToOpenClaw() {
  console.log('[OpenClaw] 正在连接到 Gateway:', CONFIG.openclaw.gatewayUrl);
  
  wsClient = new WebSocket(CONFIG.openclaw.gatewayUrl);
  
  wsClient.on('open', () => {
    console.log('[OpenClaw] WebSocket 已连接');
  });
  
  wsClient.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleOpenClawMessage(message);
    } catch (error) {
      console.error('[OpenClaw] 解析消息失败:', error);
    }
  });
  
  wsClient.on('error', (error) => {
    console.error('[OpenClaw] WebSocket 错误:', error);
  });
  
  wsClient.on('close', () => {
    console.log('[OpenClaw] 连接已断开，5秒后重连...');
    wsClient = null;
    setTimeout(connectToOpenClaw, 5000);
  });
}

/**
 * 处理来自 OpenClaw 的消息
 */
function handleOpenClawMessage(message) {
  console.log('[OpenClaw] 收到消息:', JSON.stringify(message, null, 2));
  
  // 处理 connect.challenge 事件
  if (message.type === 'event' && message.event === 'connect.challenge') {
    console.log('[OpenClaw] 收到连接挑战，发送 connect 请求');
    const connectMsg = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'connect',
      params: {
        client: 'dootask-plugin',
        version: '1.0.0'
      }
    };
    
    if (CONFIG.openclaw.token) {
      connectMsg.params.token = CONFIG.openclaw.token;
    }
    
    wsClient.send(JSON.stringify(connectMsg));
    return;
  }
  
  // 处理 RPC 响应
  if (message.result) {
    console.log('[OpenClaw] RPC 响应:', message.result);
    if (message.result.status === 'connected') {
      console.log('[OpenClaw] 已成功连接到 Gateway');
    }
    return;
  }
  
  // 处理错误
  if (message.error) {
    console.error('[OpenClaw] RPC 错误:', message.error);
    return;
  }
  
  // 处理事件通知
  if (message.method === 'event') {
    const event = message.params;
    
    // 处理消息事件
    if (event.type === 'message' && event.text) {
      const dialogId = event.dialog_id || event.metadata?.dialog_id;
      if (dialogId) {
        sendToDooTask(dialogId, event.text);
      }
    }
  }
}

/**
 * 发送消息到 DooTask
 */
async function sendToDooTask(dialogId, text, options = {}) {
  const url = `${CONFIG.dootask.apiUrl}/api/dialog/msg/sendtext`;
  
  const payload = {
    dialog_id: dialogId,
    text: text,
    text_type: options.textType || 'text',
    key: options.key || '',
    silence: options.silence || 'no',
    reply_id: options.replyId || ''
  };
  
  const postData = JSON.stringify(payload);
  
  const urlObj = new URL(url);
  const requestOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'version': CONFIG.dootask.version,
      'token': CONFIG.dootask.botToken
    }
  };
  
  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('[DooTask] 发送成功:', response);
          resolve(response);
        } catch (error) {
          console.error('[DooTask] 解析响应失败:', error);
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('[DooTask] 发送失败:', error);
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * 发送消息到 OpenClaw
 */
function sendToOpenClaw(dialogId, text, metadata = {}) {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
    console.error('[OpenClaw] WebSocket 未连接');
    return;
  }
  
  const rpcMessage = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'prompt',
    params: {
      text: text,
      metadata: {
        ...metadata,
        dialog_id: dialogId,
        source: 'dootask',
        channel: 'dootask'
      }
    }
  };
  
  console.log('[OpenClaw] 发送消息:', JSON.stringify(rpcMessage, null, 2));
  wsClient.send(JSON.stringify(rpcMessage));
}

/**
 * 处理 DooTask Webhook 请求
 */
function handleWebhook(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  
  let body = '';
  
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      let data;
      
      // 检查 Content-Type
      const contentType = req.headers['content-type'] || '';
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // URL 编码格式，需要解析
        const params = new URLSearchParams(body);
        data = {};
        for (const [key, value] of params) {
          data[key] = value;
        }
      } else {
        // JSON 格式
        data = JSON.parse(body);
      }
      
      console.log('[Webhook] 收到 DooTask 消息:', JSON.stringify(data, null, 2));
      
      // 提取消息信息
      const {
        text,
        dialog_id,
        msg_id,
        msg_uid,
        msg_user,
        mention,
        bot_uid
      } = data;
      
      // 忽略机器人自己的消息
      if (msg_uid === bot_uid) {
        console.log('[Webhook] 忽略机器人自己的消息');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ignored' }));
        return;
      }
      
      // 发送到 OpenClaw 处理
      sendToOpenClaw(dialog_id, text, {
        msg_id,
        msg_uid,
        msg_user,
        mention
      });
      
      // 响应 DooTask
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      
    } catch (error) {
      console.error('[Webhook] 处理请求失败:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

/**
 * 启动 Webhook 服务器
 */
function startWebhookServer() {
  const server = http.createServer((req, res) => {
    if (req.url === CONFIG.webhook.path) {
      handleWebhook(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(CONFIG.webhook.port, () => {
    console.log(`[Webhook] 服务器已启动: http://localhost:${CONFIG.webhook.port}${CONFIG.webhook.path}`);
    console.log(`[Webhook] 请在 DooTask 机器人配置中设置此 URL 为 Webhook 地址`);
  });
}

/**
 * 主函数
 */
function main() {
  console.log('=== OpenClaw DooTask Adapter ===');
  console.log('配置信息:');
  console.log('- DooTask API:', CONFIG.dootask.apiUrl);
  console.log('- Webhook 端口:', CONFIG.webhook.port);
  console.log('- OpenClaw Gateway:', CONFIG.openclaw.gatewayUrl);
  console.log('================================\n');
  
  // 检查必要配置
  if (!CONFIG.dootask.botToken) {
    console.error('错误: 未设置 DOOTASK_BOT_TOKEN 环境变量');
    process.exit(1);
  }
  
  // 启动服务
  startWebhookServer();
  connectToOpenClaw();
}

// 启动
main();
