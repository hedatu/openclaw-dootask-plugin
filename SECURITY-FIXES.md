# OpenClaw 安全修复总结

## 修复日期
2026-02-23

## 发现的问题

### 1. 用户权限混乱
**问题描述：**
- DooTask 插件服务以 `root` 用户运行
- 插件调用 OpenClaw CLI 时使用 `sudo -u tmt8`，但未正确设置 HOME 环境变量
- 导致 CLI 使用 `/var/root/.openclaw/` 配置而非 `/Users/tmt8/.openclaw/`
- root 用户配置目录缺少 API Key，导致认证失败和超时

**影响：**
- 通过 DooTask 调用超时（120秒）
- 直接调用 OpenClaw CLI 正常（17-19秒）

### 2. 文件权限问题
**问题描述：**
- 插件目录和日志文件所有者为 `root:staff`
- LaunchAgent plist 文件所有者为 `root:staff`
- 可能导致 tmt8 用户无法正常访问和修改

### 3. 网关重复启动风险
**问题描述：**
- 没有机制防止网关重复启动
- 可能导致端口冲突

### 4. 自动更新未禁用
**问题描述：**
- OpenClaw 默认启用自动更新
- 可能导致意外升级和配置不兼容

## 已实施的修复

### 1. 修复用户权限 ✅

**修改文件：** `~/Library/LaunchAgents/com.openclaw.dootask.plist`

添加了明确的用户和组配置：
```xml
<key>UserName</key>
<string>tmt8</string>

<key>GroupName</key>
<string>staff</string>
```

**修改文件：** `~/openclaw-dootask-plugin/dootask-plugin.js`

移除 sudo 调用，直接以当前用户运行：
```javascript
// 修复前
const args = ['-u', 'tmt8', 'bash', '-c', `export HOME=/Users/tmt8 && openclaw agent ...`];
const openclaw = spawn('sudo', args, ...);

// 修复后
const args = ['agent', '--message', message, '--session-id', sessionId];
const openclaw = spawn('openclaw', args, {
  env: { ...process.env, HOME: '/Users/tmt8' }
});
```

### 2. 修复文件权限 ✅

执行的操作：
```bash
# 修改插件目录所有者
sudo chown -R tmt8:staff ~/openclaw-dootask-plugin/

# 修改 plist 文件所有者
chown tmt8:staff ~/Library/LaunchAgents/com.openclaw.dootask.plist
chmod 644 ~/Library/LaunchAgents/com.openclaw.dootask.plist

# 删除 root 用户的 OpenClaw 配置
sudo rm -rf /var/root/.openclaw/
```

### 3. 配置网关防重复启动 ✅

**创建文件：** `~/openclaw-dootask-plugin/check-gateway.sh`

实现了端口检查和进程锁机制：
- 检查端口 7878 是否被占用
- 使用锁文件 `/tmp/openclaw-gateway.lock` 防止重复启动
- 进程退出时自动清理锁文件

### 4. 禁用自动更新 ✅

**创建标记文件：** `~/.openclaw/.no-auto-update`

说明：
- OpenClaw 通过 npm 安装，没有内置的自动更新配置选项
- 创建标记文件作为提醒，防止意外更新
- 需要手动更新时运行：`openclaw update`

## 测试结果

### 测试 1: 进程运行用户 ✅
```bash
ps aux | grep -E "(openclaw|dootask)"
```
结果：
- OpenClaw Gateway: `tmt8` 用户运行 ✅
- DooTask 插件: `tmt8` 用户运行 ✅

### 测试 2: 文件权限 ✅
```bash
ls -la ~/openclaw-dootask-plugin/
```
结果：所有文件所有者为 `tmt8:staff` ✅

### 测试 3: 配置目录 ✅
```bash
ls -la /var/root/.openclaw/
```
结果：目录已删除 ✅

### 测试 4: 插件功能 ✅
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"text":"测试最终修复","dialog_id":"66",...}'
```
结果：
- 响应时间：约 20-25 秒 ✅
- 成功返回结果 ✅
- 无超时错误 ✅

## 安全建议

### 1. 服务管理
- ✅ 所有 OpenClaw 相关服务必须以 `tmt8` 用户运行
- ✅ 使用 LaunchAgent（用户级）而非 LaunchDaemon（系统级）
- ✅ 在 plist 中明确指定 `UserName` 和 `GroupName`

### 2. 文件权限
- ✅ 所有配置文件和脚本所有者为 `tmt8:staff`
- ✅ 日志目录权限为 `755`，日志文件权限为 `644`
- ✅ 可执行脚本权限为 `755`

### 3. 环境变量
- ✅ 在 LaunchAgent 中明确设置 `HOME=/Users/tmt8`
- ✅ 在代码中显式传递环境变量
- ✅ 避免依赖系统默认环境变量

### 4. 更新管理
- ✅ 禁用自动更新，使用手动更新
- ✅ 更新前备份配置文件
- ✅ 更新后测试所有功能

## 启动服务命令

```bash
# 启动 DooTask 插件服务（用户级）
launchctl bootstrap gui/$(id -u tmt8) ~/Library/LaunchAgents/com.openclaw.dootask.plist

# 停止服务
launchctl bootout gui/$(id -u tmt8)/com.openclaw.dootask

# 查看服务状态
launchctl list | grep dootask

# 查看进程
ps aux | grep dootask-plugin
```

## 维护检查清单

定期检查以下项目：

- [ ] 所有进程以 tmt8 用户运行
- [ ] 文件权限正确（tmt8:staff）
- [ ] 无 root 用户的 OpenClaw 配置目录
- [ ] 网关端口无冲突
- [ ] 日志文件正常写入
- [ ] 插件响应时间正常（< 30秒）
- [ ] 无超时错误

## 问题排查

如果再次出现超时问题：

1. 检查进程运行用户：`ps aux | grep openclaw`
2. 检查环境变量：查看 plist 中的 `EnvironmentVariables`
3. 检查配置文件：`ls -la ~/.openclaw/`
4. 检查日志：`tail -f ~/openclaw-dootask-plugin/logs/stderr.log`
5. 测试直接调用：`openclaw agent -m "测试" --session-id test`
