#!/bin/bash

# OpenClaw DooTask 插件启动脚本

# 检查 .env 文件是否存在
if [ ! -f .env ]; then
    echo "错误: .env 文件不存在"
    echo "请复制 .env.example 为 .env 并填写配置"
    echo "  cp .env.example .env"
    exit 1
fi

# 加载环境变量
export $(cat .env | grep -v '^#' | xargs)

# 检查必要的环境变量
if [ -z "$DOOTASK_BOT_TOKEN" ]; then
    echo "错误: DOOTASK_BOT_TOKEN 未设置"
    exit 1
fi

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "正在安装依赖..."
    npm install
fi

# 启动插件
echo "正在启动 OpenClaw DooTask 插件..."
node dootask-plugin.js
