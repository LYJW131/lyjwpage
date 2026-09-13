# 项目文档与技术架构导览 (Documentation)

本目录归档 `lyjwpage` 的系统架构设计、数据后端存储、实时遥测子系统协议规范及自动化部署运维指南。

---

## 核心文档索引

| 文档 | 简介 | 核心关注点 |
| --- | --- | --- |
| [**遥测与实时状态子系统指南**](./telemetry-subsystems.md) | 全站实时状态模块接入规范与架构 | Emby、Apple Music (MusicKit/歌词)、Anker BLE 充电监测、Vibe Coding 用量与热力图、Mac/iPhone 遥测中心、HomePod mini、三档自适应调频 |
| [**Worker 数据后端与首屏缓存**](./state-storage.md) | Cloudflare Workers 数据流与 Next.js 缓存 | Durable Objects SQLite 持久化、统一信封、`'use cache'` 标签失效、ESA 边缘回源策略、数据迁移验证 |
| [**Workers 原生 Git 部署**](./workers-builds.md) | Cloudflare Workers Builds CI/CD 机制 | 三个独立 Worker 的原生构建配置、Monorepo 监视路径规则、依赖锁定与发布验收 |
| [**生产上报端点核验记录**](./reporter-endpoints.md) | 生产实例上报健康度核验与配置备份 | 各上报端点（Mac、NAS、Home Assistant、云端节点等）验证记录、备份路径与回滚说明 |

---

## 交互式架构图

- 网页在线交互版：[https://lyjw131.github.io/lyjwpage/](https://lyjw131.github.io/lyjwpage/)
- 原始架构定义：[`architecture.json`](./architecture.json) 与 [`architecture.receipt.json`](./architecture.receipt.json)
- 离线渲染快照：[`architecture-dark.png`](./architecture-dark.png) / [`architecture-light.png`](./architecture-light.png)
