---
name: lyjwpage-diagnose
description: lyjwpage 里排查并修 bug：lyjw 说「X 不对」、线上报错、Worker 或 cron 失败、页面跳动、变慢时用。先取证，再造一条能复现症状的命令，之后才猜原因、修、补回归测试。
---

# lyjwpage 排查 bug

难修的 bug 卡在「没法稳定看到它」，不卡在读代码。先有一条会变红的命令，原因能被证实，修好也能被证明；没有它，猜中的原因和碰巧消失的症状分不开。

复制这份清单到状态行，逐条推进：

```
- [ ] 1 取证
- [ ] 2 造回路：一条会变红的命令
- [ ] 3 缩到最小复现
- [ ] 4 列假设、逐条证伪
- [ ] 5 修、补回归测试
- [ ] 6 收尾
```

## 1. 取证

- 线上问题按根 `AGENTS.md`「排查线上错误」用 Cloudflare Code Mode MCP 查 Workers Issues 与遥测日志，拿调用栈和 `$workers.scriptVersion.id`；浏览器报错看 `[browser-error]` 日志里的 `release`（提交 SHA）和 `tags`，对回提交再读源码。浏览器调用栈是压缩后的代码，要反解就在 scratchpad 里检出那个 release，构建时给客户端加 `build.sourcemap: "hidden"`（只多出 map 文件，不改产物），再按 map 查行列。
- 记下 lyjw 的原话：哪个页面或卡片、什么宽度、看到了什么、原来怎样。后面每一步都对这个症状，不对附近另一个看着像的错误。
- 要回放的请求先去掉 `Authorization`、`Cookie`、`CF-Access-*` 头和 token 再存到 scratchpad。

## 2. 造回路

完成标准：说得出**一条已经跑过的命令**，贴出调用和输出，并且它

- 走真实出错的那条路径，断言的是 lyjw 说的那个症状，修好后会变绿；
- 每次结论一样（偶发问题：复现率被拉到能调试的程度）；
- 几秒到几十秒出结果；
- 无人值守就能跑。

这条命令出来之前，读代码只为了造回路，不为了猜原因。

按这个顺序找回路，用第一个够得着的：

1. 单测：纯逻辑在 `src/lib/`、`shared/`、Worker 目录里，`node --test` 跑单文件（命令见根 `AGENTS.md`「项目入口与验证」与各 Worker 的 `AGENTS.md`）。
2. 对本地 Worker 栈发请求：`pnpm dev:worker` 起栈，`curl` 打端点；此刻没发生的状态用 `pnpm dev:override <端点> <夹具>` 注入（`--list` 看已有夹具，缺的照 `workers/core/dev-fixtures/` 新写一份）；症状牵涉几张卡或要复现生产某一刻，`NODE_USE_ENV_PROXY=1 pnpm dev:scene --capture <名>` 把生产此刻整份抓下再 `pnpm dev:scene <名>` 注入。
3. 回放：把 Workers 日志里的请求或上报负载存成文件，喂给出错的函数，或 POST 到本地的上报入口。
4. 无头浏览器脚本：Playwright 断言 DOM、computed style、控制台；跳动和首帧问题按时间点截图或录帧。写法照 `.claude/skills/lyjwpage-verify/SKILL.md`「UI 浏览器端到端」。
5. 对照：同一请求打生产 `https://lyjw.me` 与本地，`diff` 两边输出。
6. 二分：lyjw 说「以前是好的」时，`git bisect run <上面那条命令>`。

偶发问题：循环跑上百次、并发、固定时间与随机种子，把复现率拉高。Safari / WebKit 才有的行为和 lyjw 设备上的现象云端复现不了：写明试过什么，请 lyjw 给带时间点的录屏或截图，拿到前不进第 4 步。

## 3. 缩到最小复现

一次去掉一个输入、调用方、配置或步骤，每去一个重跑一次。完成标准：剩下的每个元素去掉都会让命令变绿。

## 4. 列假设、逐条证伪

- 先写 3 到 5 条，按可能性排好，放进状态行，不等 lyjw 回复。每条写成可证伪的形式：「如果是 X，那么改 Y 症状就消失」。说不出预测的就不算假设。
- 每次只改一个变量，每个探针对应一条预测。
- 临时日志统一带前缀 `[DEBUG-<四位随机字符>]`，收尾时一次 `rg` 清干净。
- 性能问题先量基线（计时、`performance.now()`、Workers Observability 的 traces 与 CPU / wall 时间），再二分，不靠日志。

## 5. 修、补回归测试

- 回归测试写在**正确的接缝**上：公开接口，按真实调用方的方式调用。先看它红，再修，再看它绿。
- 期望值来自独立的事实（已知正确的字面量、lyjw 给的例子、规格），不按代码的算法再算一遍。
- 找不到正确接缝（能测到的那层比出错链条浅）就不写这条测试，在 PR 里写明缺这个接缝。站点 UI 问题以浏览器端到端为准，按 `AGENTS.md` 可以不写单测。
- 修完重跑第 2 步那条**没缩小的**原始命令。

## 6. 收尾

- [ ] 原始回路不再复现
- [ ] 回归测试通过，或 PR 写明没有正确接缝
- [ ] `rg "\[DEBUG-"` 为空，临时脚本只在 scratchpad
- [ ] PR 正文写根因：哪条假设成立，证据是什么
- [ ] 按 `lyjwpage-verify` 验证；合并部署后在生产复测 lyjw 说的那个症状，Workers Issues 的写操作照 `AGENTS.md`「排查线上错误」的时机做
