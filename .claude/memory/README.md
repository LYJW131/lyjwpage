# 项目公开记忆

本目录是 `lyjwpage` 项目公开记忆的**唯一真相源**（原为 Claude Projects 云端项目记忆的镜像，2026-11-25 迁至 T3 Code 后改为单源直管）：`MEMORY.md` 是索引，其余每个文件一个主题。

- **直接维护，不再镜像同步**：新增、修改或删除公开项目记忆（架构事实、关键取舍、踩坑教训、`not-adopting` 清单）时，直接改本目录文件，随当前功能 PR 或单独开 `docs(memory):` 小 PR 合入。本地跑过 `pnpm docs:check` 即可合并，这类纯文档 PR 不必等 CI 与机器评审。旧的 03:15「记忆镜像同步」定时任务已永久下线。
- **公私边界**：本仓库公开，**严禁**在本目录写入任何凭据、私钥、个人隐私、机器专属 ID 或私有链接。仅本机/个人可见的环境备注放在仓库外的 `~/.agents/projects/lyjwpage.md`，不入 git。提交前可用 `scripts/memory-mirror.ts#findSecrets` 做防泄漏自查。
- **流程类约束的生效方式**：10-26 的知识评测（`agent-knowledge-eval-plan.md`）证实，只写在文档或记忆里的流程步骤容易被跳过；高频易忘的流程约束应由主协调员直接写入任务简报，能机械判定的尽量升级为 ESLint / `scripts/rules-check.ts`。
- 这里的条目记的是写入时的事实，带日期、可能指向后来改名的路径，`pnpm docs:check` 不检查本目录（`scripts/docs-check.ts#MEMORY_MIRROR_DIR`）。
