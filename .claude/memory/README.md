# 项目记忆镜像

Claude Projects 里 lyjwpage 项目记忆的仓库副本：`MEMORY.md` 是索引，其余每个文件一个主题，文件名与项目记忆里的同名。项目记忆是源，这里是镜像；两边不一致时以项目记忆为准，并当轮把这里改齐。

- 谁改了项目记忆（新增、修改、删除），同一轮把改动同步到这里，开一个只改 `.claude/memory/` 的小 docs PR；手上已有 PR 时可以顺带进那个 PR。每天 03:15（Asia/Shanghai）还有一个定时任务「lyjwpage 记忆镜像同步」兜底：由 Sonnet 5.5（中等思考强度）子代理跑下面的脚本，有差异就开 `docs(memory):` PR，本地 `pnpm docs:check` 过了自己合。这类 PR 不改代码逻辑，不必等 CI 与机器评审。
- 同步用 `pnpm memory:mirror <项目记忆目录>`（`scripts/memory-mirror.ts`），不手抄：原样照抄，删掉源里已没有的主题，自动脱敏，去掉 frontmatter 的 `modified:` 行（历史在 git log），私有 claude.ai Artifact 链接换成 `<private claude.ai link>`，云端环境与会话 ID 换成 `<internal id>`，`scripts/memory-mirror.ts#CLOUD_ENV_NAMES` 里的云端环境名换成 `<cloud env>`，Mac 用户目录写成 `~/`。脱敏后仍像凭据的内容（私钥、各家 token、`*_SECRET=值` 之类，见 `scripts/memory-mirror.ts#findSecrets`）会让脚本报错退出、一个文件都不写，先在项目记忆里删掉再同步。
- 这里的条目记的是写入时的事实，带日期、可能指向后来改名的路径，`pnpm docs:check` 不检查本目录（`scripts/docs-check.ts#MEMORY_MIRROR_DIR`）。
