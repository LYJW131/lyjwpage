# 文档索引

> 类型：reference

本目录放跨子项目的文档；各子项目自己的说明在它目录里的 `README.md`，给 agent 的约束在同目录的 `AGENTS.md`。写法规范见根 [`AGENTS.md`](../AGENTS.md)「文档与注释」，`pnpm docs:check` 校验。

每篇文首一行标类型：`reference` 是现状事实，与代码冲突以代码为准；`runbook` 是操作步骤；`decision` 是已定的取舍，写完不改；`record` 是某个时点的审计、核验、基准，标明 `按 <sha> <日期> 核对`，快照不维护，不当现状引用。新增文档在下表登记。

| 文档 | 类型 | 内容 |
| --- | --- | --- |
| [遥测与实时状态子系统指南](./telemetry-subsystems.md) | reference | 各实时状态模块的接入方式、数据流向、协议决策与运维备忘 |
| [Worker 数据后端与首屏缓存](./state-storage.md) | reference | 状态分层存储（DO / KV / D1）、公开数据边界、首屏缓存与失效、配置 |
| [Workers 原生 Git 部署](./workers-builds.md) | reference | Worker 的 Workers Builds 构建配置、监视路径与分支预览 |
| [AI Worker 首次迁移](./ai-worker-migration.md) | runbook | 公开状态 RPC、聊天 DO 转移、密钥与构建配置的有序切换 |
| [MCP Events](./mcp-events.md) | reference | 公开播放变化的 webhook 订阅、身份隔离、持久化投递与回调安全边界 |
| [仓库外事实](./ops-facts.md) | reference | 控制台、Access、ESA、机器路径等不在仓库里的配置，逐条带核对时间与方式 |
| [页面效果图、GIF 与架构图产物](./screenshots.md) | runbook | 根 README 效果图与 GIF 的录制流程，架构图重生成 |
| [iOS App 上机验证](./ios-app-handoff.md) | runbook | `apps/ios` 的系统音乐、健康上报、小组件、快捷指令及后台设备验收 |
| [iOS App 验证记录](./ios-app-verification.md) | record | SDK 构建、模拟器端到端验证与签名装机的核验快照 |
| [讲解动画](./explainer/README.md) | runbook | `/explainer` 页面源、预览、渲染配乐与发布 |
| [讲解动画 · 事实基线](./explainer/FACTS.md) | reference | 动画里每个端点、数字的出处；架构变了先改这份 |
| [讲解动画 · 画面升级本子](./explainer/TREATMENT.md) | reference | 下一版讲解动画的概念、风格、分镜结构与技术路线 |
| [讲解动画 · 分镜与旁白](./explainer/SCRIPT.md) | reference | v2 新片的章节表、每小节画面要点与中英旁白 |
| [讲解动画 · 写章约定](./explainer/v2/CONVENTIONS.md) | reference | v2 章节作者的契约：章节接口、组件、字号、镜头、自检 |
| [讲解动画 · 写章任务书](./explainer/v2/CHAPTER-BRIEF.md) | runbook | 并行写章时派单的模板 |
| [生产上报端点核验记录](./reporter-endpoints.md) | record | 各上报实例的端点核验与迁移记录 |
| [DO 执行边界审计](./do-execution-audit.md) | record | 哪些工作进 Durable Object、哪些留在普通 Worker 的审计 |
| [DO 优化线上效果核验](./do-performance-audit.md) | record | 执行边界调整上线前后的线上指标与本地存储基准 |
| [别处播放推断精度实测](./listening-inference-accuracy.md) | record | iPhone 连续播放时 Apple「最近播放的歌」何时上榜，各拉取间隔下推断的标对率与开播误差 |

## 架构图

网页版：[lyjw131.github.io/lyjwpage](https://lyjw131.github.io/lyjwpage/)。源是 [`architecture.json`](./architecture.json)，改图只改它，其余产物的重生成步骤见 [screenshots.md](./screenshots.md#交互式架构图)。
