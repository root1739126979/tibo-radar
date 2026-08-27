# Tibo Radar

Tibo Radar 在云端监控 `@thsottiaux` 的 Codex 配额重置信号，并在本机每 10 分钟读取你的真实周配额。Tibo 信号不会消耗你的模型额度；本机配额通过 Codex 官方 App Server 读取，也不会调用模型。

## 直接使用

双击 `查看状态.cmd`，或在此目录运行：

```powershell
npm run status
```

输出包括当前周配额剩余百分比、自然重置时间、最近 Tibo 信号，以及最近一次重置到来时未花完的额度。

## 本地 10 分钟监控

安装计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
```

计划任务名为 `TiboRadarQuotaMonitor`。本地记录保存在未纳入 Git 的 `data/` 目录。卸载命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
```

## 云端提醒

仓库的 `Tibo reset monitor` GitHub Actions 每 10 分钟读取两个公开结构化信号源。识别到新提示或完成事件时，它会创建一个带 `tibo-radar` 标签的 Issue；事件键写入 Issue，因此重复运行不会重复提醒。

## 检查

```powershell
npm test
npm run doctor
npm run cloud:dry-run
```

运行依赖只有 Node.js 20+、已登录的 Codex CLI，以及 Windows 计划任务。代码不读取或上传 ChatGPT Cookie、访问令牌、对话内容或账号身份。
