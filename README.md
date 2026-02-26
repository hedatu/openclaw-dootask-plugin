# OpenClaw DooTask Plugin

将 DooTask 机器人消息通过 Webhook 接入 OpenClaw，并把模型回复回写到 DooTask。

## 功能

- 接收 DooTask Webhook 消息
- 调用本机 OpenClaw（CLI 模式）处理消息
- 将回复发送回 DooTask 频道
- 基础日志输出与超时保护

## 目录结构

- `dootask-plugin.js`：主程序（Webhook -> OpenClaw CLI -> DooTask 回写）
- `dootask-adapter.js`：备用实现（WebSocket 方式）
- `.env.example`：环境变量模板
- `start.sh`：启动脚本
- `com.openclaw.dootask.plist`：macOS LaunchAgent 示例

## 环境要求

- Node.js 18+
- 可执行的 `openclaw` 命令
- 可访问的 DooTask 服务地址与 Bot Token

## 安装

```bash
npm install
```

## 配置

复制模板：

```bash
cp .env.example .env
```

填写至少以下变量：

```env
DOOTASK_API_URL=http://127.0.0.1:2222
DOOTASK_BOT_TOKEN=your_dootask_bot_token
WEBHOOK_PORT=3000
OPENCLAW_TOKEN=your_openclaw_token
```

> `OPENCLAW_TOKEN` 请从你的 OpenClaw 配置中获取；不要提交 `.env` 到仓库。

## 运行

```bash
node dootask-plugin.js
```

或：

```bash
./start.sh
```

## Webhook 配置

在 DooTask 机器人侧把回调地址设置为：

```text
http://<你的局域网IP>:3000/webhook
```

## 常见问题

1. **收不到回调**：确认 DooTask 能访问你的 IP 与端口。
2. **调用超时**：检查 `openclaw` 网关是否正常，模型是否可用。
3. **无回复**：检查 `DOOTASK_BOT_TOKEN`、`OPENCLAW_TOKEN` 是否正确。

## 安全说明

- 已忽略：`.env`、`node_modules/`、`logs/`
- 请勿在代码中硬编码 API Key/Token

## License

MIT