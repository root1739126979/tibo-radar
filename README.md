# Tibo Radar

Tibo Radar 在云端监控 `@thsottiaux` 的 Codex 配额重置信号，并在本机每 10 分钟读取你的真实周配额。Tibo 信号不会消耗你的模型额度；本机配额通过 Codex 官方 App Server 读取，也不会调用模型。

## 直接使用

双击 `查看状态.cmd`，或在此目录运行：

```powershell
npm run status
```

输出包括当前周配额、最近 Tibo 信号、最近一次真实重置、计划任务健康、App 配置状态、待发送数量和最近脱敏错误。单项检查失败会显示“未知”，不会掩盖其余状态。

## Server酱³ App 通知

先在手机登录 Server酱³ App 并取得 `sctp...` SendKey，然后双击 `配置App通知.cmd`。在隐藏输入提示中粘贴一次密钥；不要把 SendKey 发到聊天或写进配置文件。

配置程序会依次发送 `[本机测试]` 和 `[云端测试]` 两条通知，并把 SendKey 写入 Cloudflare Worker Secret。全部成功后才启用正式通知：

- `Tibo 即将进行重置`；
- `Tibo 即将发放 Banked Reset`；
- `你的周配额已经重置`，并按样本新鲜度说明重置前未用额度。

"Tibo 已经进行了重置"、已过期的历史信号和正常心跳不会推送。重新双击配置入口可安全替换密钥。App 临时失败时，本机事件保留在待发送队列；Cloudflare 信号会在后续 Cron 中重试。

## 本地 10 分钟监控

安装计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
```

计划任务名为 `TiboRadarQuotaMonitor`，在当前用户登录后立即运行，之后每 10 分钟运行。失败后每分钟重试、最多三次；休眠时不唤醒电脑，恢复后补跑。异常退出遗留的采样锁超过三分钟后会核对进程 PID 与启动时间再安全回收；若系统暂时无法核对，最多保守等待 30 分钟。它通过无窗口的 Windows Script Host 运行，不会弹出控制台或抢占焦点。本地记录保存在未纳入 Git 的 `data/` 目录。卸载命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
```

卸载只删除任务，不删除配额历史、待发送事件或 DPAPI 密钥。用户手动禁用任务后，程序不会擅自重新启用。

## 云端提醒

Cloudflare Worker 每 5 分钟读取两个公开结构化信号源。它接收 `codex-reset.com` 的活动信号、Banked Reset 状态与事件，以及 `codexrunway.com` 的 `reset_scheduled` 和 `resetTimeline.nextSchedule`；推文语义只作为兼容旧数据的备用。所有结果按提醒阶段和原推文 ID 归一化，同一事件被两个上游同时报告时只推送一次。Worker 使用 KV 保存启用水位、最近运行状态和已发送事件键，使用加密 Secret 保存 Server酱³ SendKey。只有鉴权后的云端测试成功才会写入启用水位；在此之前 Cron 不读取信号源。发送失败不会写入已发送状态，下一次 Cron 会重试。云端不接触本机 Codex 凭据，也不调用模型。

健康状态可以通过 `https://tibo-radar.sdcz900828.workers.dev/health` 查看；最近一次成功 Cron 超过 15 分钟或最近一次调度失败时会返回不健康。部署和日志命令：

```powershell
npm run cloudflare:deploy
npm run cloudflare:tail
```

## 故障排查与诊断

- `data/errors.log`：脱敏错误，自动限制为 1 MiB 并保留最近 30 天。
- `data/notification-outbox.json`：本机 App 通知状态；已发送项保留 30 天，待发送项保留到成功。
- Cloudflare Worker Logs 和 `/health`：云端诊断入口。
- 清理普通诊断：`powershell -ExecutionPolicy Bypass -File .\scripts\clear-diagnostics.ps1`。此命令不会删除配额历史、真实重置事件、待发送项或密钥。

如 App 显示未配置或最近错误提示密钥失效，重新运行 `配置App通知.cmd`。如需停止后台采样，运行卸载脚本；恢复时重新运行安装脚本。

## 检查

```powershell
npm test
npm run test:configure
npm run test:windows-task
npm run test:manual-status
npm run doctor
npm run cloud:dry-run
```

日常运行依赖只有 Node.js 20+、已登录的 Codex CLI，以及 Windows 计划任务。首次部署或重新配置云端部分还需要网络、Cloudflare 账号和已登录的 Wrangler。代码不读取或上传 ChatGPT Cookie、访问令牌、对话内容或账号身份。
