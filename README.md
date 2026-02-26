# OpenClaw DooTask 插件

基于 Telegram 插件模式的 DooTask 插件，用于连接 OpenClaw 和 DooTask。

## 功能特性

- ✅ 接收 DooTask Webhook 消息
- ✅ 连接 OpenClaw Gateway
- ✅ 发送 AI 回复到 DooTask
- ✅ 自动重连机制
- ✅ 消息去重（忽略机器人自己的消息）

## 安装步骤

### 1. 安装依赖

```bash
cd openclaw-dootask-plugin
npm install
```

### 2. 配置环境变量

复制配置文件模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填写以下配置：

```bash
# DooTask 配置
DOOTASK_API_URL=http://192.168.1.67:2222
DOOTASK_BOT_TOKEN=你的DooTask机器人Token

# Webhook 服务器配置
WEBHOOK_PORT=3000

# OpenClaw Gateway 配置
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:7878
OPENCLAW_TOKEN=你的OpenClaw Token（可选）
```

### 3. 获取配置信息

#### DooTask Bot Token
1. 在 DooTask 中创建机器人
2. 获取机器人的 Token

#### OpenClaw Token
从 OpenClaw 配置文件获取：

```bash
cat ~/.openclaw/openclaw.json | grep -A 3 '"auth"'
```

### 4. 配置 DooTask Webhook

在 DooTask 机器人设置中，将 Webhook 地址设置为：

```
http://你的MacBook局域网IP:3000/webhook
```

## 使用方法

### 启动插件

```bash
./start.sh
```

或者直接运行：

```bash
node dootask-adapter.js
```

### 测试

1. 确保 OpenClaw Gateway 正在运行
2. 启动插件
3. 在 DooTask 对话中发送消息给机器人
4. 机器人应该会通过 OpenClaw 处理并回复

## 工作流程

```
DooTask 用户消息
    ↓
DooTask Webhook 推送
    ↓
插件接收 (HTTP Server)
    ↓
转发到 OpenClaw Gateway (WebSocket)
    ↓
OpenClaw AI 处理
    ↓
插件接收 AI 回复 (WebSocket)
    ↓
调用 DooTask API 发送消息
    ↓
用户收到回复
```

## 日志说明

- `[Webhook]` - Webhook 服务器相关日志
- `[OpenClaw]` - OpenClaw Gateway 连接日志
- `[DooTask]` - DooTask API 调用日志

## 故障排查

### 1. Webhook 收不到消息

- 检查 DooTask 机器人 Webhook 配置是否正确
- 确认端口 3000 没有被占用
- 检查防火墙设置

### 2. 无法连接 OpenClaw Gateway

- 确认 OpenClaw Gateway 正在运行：`openclaw gateway status`
- 检查 Gateway URL 配置是否正确
- 查看 Gateway 日志：`tail -f /tmp/openclaw/openclaw-*.log`

### 3. 无法发送消息到 DooTask

- 检查 DooTask API URL 是否正确
- 确认 Bot Token 是否有效
- 查看 DooTask API 返回的错误信息

## 高级配置

### 修改 Webhook 端口

编辑 `.env` 文件：

```bash
WEBHOOK_PORT=8080
```

### 局域网访问

由于你们在同一个局域网，DooTask 可以直接访问你的 MacBook IP。

获取你的局域网 IP：
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

然后在 DooTask 中配置 Webhook 为：
```
http://你的局域网IP:3000/webhook
```

## 开发说明

插件基于 Telegram 插件的设计模式：

- 使用 HTTP Server 接收 Webhook
- 使用 WebSocket 连接 OpenClaw Gateway
- 使用 HTTP Client 调用 DooTask API

核心文件：
- `dootask-adapter.js` - 主程序
- `package.json` - 依赖配置
- `.env` - 环境变量配置
- `start.sh` - 启动脚本

## 许可证

MIT
