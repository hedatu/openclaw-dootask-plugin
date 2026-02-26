<div align="center">

# OpenClaw DooTask Plugin

**中文｜English**

让 DooTask 与 OpenClaw 无缝对接：接收 Webhook，调用模型，并自动回写回复。

</div>

---

## 中文说明

### ✨ 功能特性

- 接收 DooTask Webhook 消息
- 调用本机 `openclaw` 进行 AI 处理
- 将处理结果自动发送回 DooTask
- 内置超时保护与基础日志输出

### 📦 目录结构

- `dootask-plugin.js`：主流程（Webhook → OpenClaw CLI → DooTask 回写）
- `dootask-adapter.js`：备用 WebSocket 方案
- `.env.example`：环境变量模板
- `start.sh`：启动脚本
- `com.openclaw.dootask.plist`：macOS LaunchAgent 示例

### 🚀 快速开始

```bash
npm install
cp .env.example .env
node dootask-plugin.js
```

### ⚙️ 必填环境变量

```env
DOOTASK_API_URL=http://127.0.0.1:2222
DOOTASK_BOT_TOKEN=your_dootask_bot_token
WEBHOOK_PORT=3000
OPENCLAW_TOKEN=your_openclaw_token
```

### 🔗 Webhook 地址

在 DooTask 机器人配置中设置：

```text
http://<你的局域网IP>:3000/webhook
```

### 🛠 常见问题

1. **收不到消息**：确认 DooTask 能访问你的 IP/端口。
2. **调用超时**：检查 OpenClaw 网关和模型状态。
3. **无回复**：检查 Token 是否正确。

### 🔐 安全建议

- 不要提交 `.env`
- 不要在代码中硬编码 Token / API Key

---

## English

### ✨ Features

- Receives DooTask Webhook messages
- Calls local `openclaw` for AI processing
- Sends replies back to DooTask automatically
- Includes timeout protection and logging

### 📦 Structure

- `dootask-plugin.js`: main flow (Webhook → OpenClaw CLI → DooTask reply)
- `dootask-adapter.js`: alternative WebSocket implementation
- `.env.example`: environment template
- `start.sh`: startup script
- `com.openclaw.dootask.plist`: macOS LaunchAgent example

### 🚀 Quick Start

```bash
npm install
cp .env.example .env
node dootask-plugin.js
```

### ⚙️ Required Environment Variables

```env
DOOTASK_API_URL=http://127.0.0.1:2222
DOOTASK_BOT_TOKEN=your_dootask_bot_token
WEBHOOK_PORT=3000
OPENCLAW_TOKEN=your_openclaw_token
```

### 🔗 Webhook URL

Set this in your DooTask bot config:

```text
http://<your-lan-ip>:3000/webhook
```

### 🔐 Security Notes

- Never commit `.env`
- Never hardcode secrets in source code

---

## License

MIT
