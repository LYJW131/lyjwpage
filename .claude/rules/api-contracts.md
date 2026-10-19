---
paths:
  - "shared/**"
  - "workers/**"
  - "reporters/**"
  - "apps/ios/**"
  - "src/lib/status-*"
  - "src/app/api/**"
---

# 跨端契约

新增或修改上报入口、状态端点、推送事件、跨来源字段前，先读 `docs/api-contracts.md`（命名表与设计契约），再按根 `AGENTS.md`「变更完成条件」改全生产者、接收端、消费者与推送事件。
