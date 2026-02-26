#!/bin/bash

# OpenClaw DooTask 插件服务卸载脚本

PLIST_FILE="com.openclaw.dootask.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
SERVICE_NAME="com.openclaw.dootask"

echo "=== OpenClaw DooTask 服务卸载 ==="

# 停止并卸载服务
if launchctl list | grep -q "$SERVICE_NAME"; then
    echo "停止服务..."
    launchctl unload "$LAUNCH_AGENTS_DIR/$PLIST_FILE"
    echo "✅ 服务已停止"
else
    echo "服务未运行"
fi

# 删除 plist 文件
if [ -f "$LAUNCH_AGENTS_DIR/$PLIST_FILE" ]; then
    echo "删除服务配置..."
    rm "$LAUNCH_AGENTS_DIR/$PLIST_FILE"
    echo "✅ 服务配置已删除"
fi

echo "卸载完成"
