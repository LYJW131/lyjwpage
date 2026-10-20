---
paths:
  - "**/*.md"
---

# 写文档

- 仓库外的事实（控制台配置、Access 策略、机器路径）只写在 `docs/ops-facts.md`，逐条带「核对于 <日期>，方式：…」；正文里远端路径写成 `主机:/绝对路径`。
- `docs/` 每篇文首一行标类型：`reference`（现状事实）、`runbook`（操作步骤）、`decision`（已定取舍，写完不改）、`record`（某时点的审计、核验、基准，另写「按 <sha> <日期> 核对，快照不维护，不当现状引用」）。新增文档在 `docs/README.md` 登记。
- 根 `AGENTS.md` 的字节上限是 `scripts/docs-check.ts#ROOT_AGENTS_MAX_BYTES`，只写每次会话都用得上的硬规则与禁区、完成条件、权威事实源的指针；不写目录或文件清单、来源枚举、数量版本日期、部署拓扑、迁移步骤，只在部分时候用的流程放进 skill，只跟部分目录有关的规则放进带 `paths` 的 `.claude/rules/`。子目录 `AGENTS.md` 的上限是 `scripts/docs-check.ts#NESTED_AGENTS_MAX_BYTES`，同目录放一行 `@AGENTS.md` 的 `CLAUDE.md`，只写不变量、坑、本地验证命令、须成对修改的文件；人读的说明留在 `README.md`。
- 确需保留时间线写法（如核对戳）时，在同一行末尾加 `<!-- allow: 理由 -->`。
