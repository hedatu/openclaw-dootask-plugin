#!/bin/bash
# OpenClaw Gateway 单实例检查脚本

GATEWAY_PORT=7878
LOCK_FILE="/tmp/openclaw-gateway.lock"

# 检查端口是否被占用
if lsof -Pi :$GATEWAY_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Gateway 已在端口 $GATEWAY_PORT 运行"
    exit 1
fi

# 检查锁文件
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Gateway 进程 $PID 已在运行"
        exit 1
    else
        # 清理过期的锁文件
        rm -f "$LOCK_FILE"
    fi
fi

# 创建锁文件
echo $$ > "$LOCK_FILE"

# 启动网关
exec openclaw gateway --port $GATEWAY_PORT

# 清理锁文件（进程退出时）
trap "rm -f $LOCK_FILE" EXIT
