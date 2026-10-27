# REVIEW.md

给 PR 评审代理（Claude review、Codex、Devin Review）的评审指引。项目规矩本身在 [`AGENTS.md`](./AGENTS.md)，这里只写评审时报什么、不报什么、怎么报。

## 什么算出错

- 跨端契约被改坏：`shared/` 下 Worker 之间的契约只加不改，上报字段、状态端点与推送事件的命名按 `docs/api-contracts.md`。
- 数据走错地方：站点侧写了后端逻辑、跨域 `fetch` 后端、密钥或状态落进站点 Worker（见 `AGENTS.md`「禁区」）。
- 文档或注释说的和代码不一致。
- 缓存、首屏 SSR、Cache-Tag 清除行为被改变而 PR 没说明。

## 不报

- CI 已经拦的：lint、类型、格式、`pnpm docs:check`、`pnpm rules:check`、`pnpm design:scale`、`pnpm ui:copy`、`pnpm baselines:check`。
- 生成物与存量记录：`pnpm-lock.yaml`、`scripts/*-baseline.json`、`docs/diagrams/*.svg`、`.claude/memory/` 镜像、`docs/` 里类型为 `record` 的文档。
- 这次改动没碰到的旧代码里的问题：可以提，但标成不挡合并。
- 边缘情况与防御性加固：要罕见输入、假设的竞态或时序、外部服务异常、开发脚本的参数校验才触发的，合成一条、标成可选，不给阻塞级别（P0 / P1、blocker、🟥）。阻塞级别只给按这次改动的用意正常使用就会出错的缺陷。

## 怎么报

- 每条结论带文件和行号作证据，不凭名字推测行为。
- 写出缺陷的类别，并列出 PR 里同类的其他位置，让作者一次修完。
- 已经在这个 PR 上发过的发现不再重复；复审只看上次审过之后的新改动，不回头在先前审过的代码里找更罕见的情况。
- 风格、命名类的意见至多报三条，标成可选。
- 总结第一行写发现了几条；没有要改的就直说没有。
