# 给其他 AI 的 Codex 配额查询说明

维护：Tibo Radar 项目；状态：可用；最后实测：2026-10-03。Codex CLI 或返回结构变更时复核。

## 在这台电脑上直接查询

需要 Node.js 20+，并以已登录 Codex 的 Windows 用户运行。以下 PowerShell 命令只读取配额，输出 JSON，不发通知、不调用模型，也不消耗重置卡：

```powershell
Set-Location -LiteralPath 'E:\一句话开发\tibo-radar'
node --input-type=module -e 'import {readAccountRateLimits} from "./src/quota/app-server.js"; import {normalizeQuotaSample} from "./src/quota/normalize.js"; try { console.log(JSON.stringify(normalizeQuotaSample(await readAccountRateLimits()),null,2)) } catch(e) {console.error(e.message);process.exitCode=1}'
```

另一个 Node.js 程序也可以调用上述两个导出函数：`readAccountRateLimits()` 获取实时原始结果，`normalizeQuotaSample(payload)` 提取 Codex 周窗口。

主要输出字段：

| 字段 | 含义 |
| --- | --- |
| `sampledAt` | 查询时间，UTC ISO 格式 |
| `usedPercent` | 周配额已用百分比 |
| `remainingPercent` | 周配额剩余百分比，按 `100 - usedPercent` 计算并限制为 0–100 |
| `resetsAt` | 服务返回的重置时间，UTC ISO 格式；用 `Asia/Shanghai` 显示北京时间 |
| `windowDurationMins` | 窗口长度；一周为 10080 分钟 |
| `planType` | 账号订阅计划 |

查询结果是当时的快照，不能换算成精确剩余 token 数，也不代表此后仍有相同余额。

## 如果 AI 已有 Codex App 工具

若工具列表包含 `get_usage_limits`，直接调用它，无需另起进程。按当前主机实际提供的工具名调用，不要假设所有 AI 都有这个工具。原始结果按下节解析。

## 在其他环境自行实现

官方接口是 Codex App Server 的 `account/rateLimits/read`。启动 `codex app-server`（默认 stdio，逐行 JSON），通过子进程 stdin/stdout 通信：

1. 发送初始化请求：

   ```json
   {"id":1,"method":"initialize","params":{"clientInfo":{"name":"quota-reader","version":"1.0.0"}}}
   ```

2. 等待 `id:1` 的成功响应，再发送通知和查询：

   ```json
   {"method":"initialized"}
   {"id":2,"method":"account/rateLimits/read"}
   ```

3. 读取 `id:2` 的 `result`。优先选 `rateLimitsByLimitId.codex`，缺失时用 `rateLimits`；在其 `primary` 和 `secondary` 中按 `windowDurationMins` 找周窗口，不能固定认为 `secondary` 就是周配额。本项目选择长度至少 10080 分钟的窗口。
4. `usedPercent` 是已用比例；剩余为 `max(0, min(100, 100 - usedPercent))`。原始 `resetsAt` 是 Unix **秒**，转换为 JavaScript 日期需要乘 1000。缺失或无效字段视为未知，不能当成 0 或 100%。
5. 设置超时、处理 JSON-RPC `error`，完成后结束子进程。只做配额查询不需要创建 thread 或启动 turn。

必须有该环境可用的本人 Codex 登录态；普通 OpenAI API key 不等于 ChatGPT 订阅配额登录态。远程 AI 无法仅凭这份文档访问本机账号，可在本机封装上述只读调用为它的工具。不要复制或上传 `auth.json`、访问令牌或 Cookie。

## 失败和缓存

- `authentication required`：当前进程没有可用登录态。检查 Windows 用户和 `CODEX_HOME` 是否与已登录环境一致；需要登录时在该环境执行 `codex login`。
- `spawn codex.exe ENOENT`：没有找到 CLI。本项目支持用 `CODEX_BIN` 指定 `codex.exe` 的绝对路径；必须由可信配置给出。
- 超时、缺失周窗口：返回“查询失败/未知”，不要编造余额。
- 查询失败时，可用 `Get-Content -LiteralPath 'E:\一句话开发\tibo-radar\data\quota-history.jsonl' -Tail 1` 读取最近缓存。必须附带 `sampledAt` 并标为“最近已知”，电脑休眠时缓存不会每 10 分钟更新。
- 查询能力不要调用 `npm run sample`，它还会持久化状态并可能发送通知；不要调用 `account/rateLimitResetCredit/consume`，它会消耗重置卡。

官方协议：[Codex App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)。本机实现：[查询客户端](../src/quota/app-server.js)、[周窗口解析](../src/quota/normalize.js)。
