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

配置程序会依次发送 `[本机测试]` 和 `[云端测试]` 两条通知，并把固定仓库的 Actions 日志保留期设为 30 天。全部成功后才启用正式通知：

- `Tibo 即将进行重置`；
- `你的周配额已经重置`，并按样本新鲜度说明重置前未用额度。

“Tibo 已经进行了重置”、历史信号、超过两小时的旧信号和正常心跳不会推送。重新双击配置入口可安全替换密钥。App 临时失败时事件留在本机或 GitHub Issue 的待发送状态，后续自动补发。

## 本地 10 分钟监控

安装计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
```

计划任务名为 `TiboRadarQuotaMonitor`，在当前用户登录后立即运行，之后每 10 分钟运行。失败后每分钟重试、最多三次；休眠时不唤醒电脑，恢复后补跑。它通过无窗口的 Windows Script Host 运行，不会弹出控制台或抢占焦点。本地记录保存在未纳入 Git 的 `data/` 目录。卸载命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
```

卸载只删除任务，不删除配额历史、待发送事件或 DPAPI 密钥。用户手动禁用任务后，程序不会擅自重新启用。

## 云端提醒

仓库的 `Tibo reset monitor` GitHub Actions 每 5 分钟读取两个公开结构化信号源。识别到新提示或完成事件时，它会创建一个带 `tibo-radar` 标签的 Issue；事件键和 `pending/sent/expired` 标签保证可追踪与重试。云端只持有 GitHub Secret，不接触本机 Codex 凭据。

## 故障排查与诊断

- `data/errors.log`：脱敏错误，自动限制为 1 MiB 并保留最近 30 天。
- `data/notification-outbox.json`：本机 App 通知状态；已发送项保留 30 天，待发送项保留到成功。
- GitHub Actions 运行和带状态标签的 Issue：云端诊断入口。
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

运行依赖只有 Node.js 20+、已登录的 Codex CLI，以及 Windows 计划任务。代码不读取或上传 ChatGPT Cookie、访问令牌、对话内容或账号身份。
