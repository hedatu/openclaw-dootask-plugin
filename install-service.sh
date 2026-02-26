#!/bin/bash

# OpenClaw DooTask 插件服务安装脚本

PLIST_FILE="com.openclaw.dootask.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
SERVICE_NAME="com.openclaw.dootask"

echo "=== OpenClaw DooTask 服务安装 ==="

# 检查 plist 文件是否存在
if [ ! -f "$PLIST_FILE" ]; then
    echo "错误: $PLIST_FILE 文件不存在"
    exit 1
fi

# 创建 LaunchAgents 目录
mkdir -p "$LAUNCH_AGENTS_DIR"

# 停止并卸载旧服务（如果存在）
if launchctl list | grep -q "$SERVICE_NAME"; then
    echo "停止现有服务..."
    launchctl unload "$LAUNCH_AGENTS_DIR/$PLIST_FILE" 2>/dev/null || true
fi

# 复制 plist 文件
echo "安装服务配置..."
cp "$PLIST_FILE" "$LAUNCH_AGENTS_DIR/"

# 加载服务
echo "启动服务..."
launchctl load "$LAUNCH_AGENTS_DIR/$PLIST_FILE"

# 检查服务状态
sleep 2
if launchctl list | grep -q "$SERVICE_NAME"; then
    echo "✅ 服务安装成功！"
    echo ""
    echo "服务管理命令:"
    echo "  查看状态: launchctl list | grep $SERVICE_NAME"
    echo "  停止服务: launchctl unload ~/Library/LaunchAgents/$PLIST_FILE"
    echo "  启动服务: launchctl load ~/Library/LaunchAgents/$PLIST_FILE"
    echo "  查看日志: tail -f logs/stdout.log logs/stderr.log"
else
    echo "❌ 服务安装失败"
    exit 1
fi
