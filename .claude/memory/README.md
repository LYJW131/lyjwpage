# 项目记忆镜像

Claude Projects 里 lyjwpage 项目记忆的仓库副本：`MEMORY.md` 是索引，其余每个文件一个主题，文件名与项目记忆里的同名。项目记忆是源，这里是镜像；两边不一致时以项目记忆为准，并当轮把这里改齐。

- 谁改了项目记忆（新增、修改、删除），同一轮把改动同步到这里，开一个只改 `.claude/memory/` 的小 docs PR；手上已有 PR 时可以顺带进那个 PR。这类 PR 不改代码逻辑，CI 绿就合，不等机器评审。
- 原样照抄，只做两处处理：去掉 frontmatter 里的 `modified:` 行（历史在 git log）；去掉不该公开的内容：凭据和凭据的值、私有链接（claude.ai 的 Artifact / 文档链接）、云端环境与内部会话 ID。去掉的地方改写成一句不含该值的话，不留占位。
- 这里的条目记的是写入时的事实，带日期、可能指向后来改名的路径，`pnpm docs:check` 不检查本目录（`scripts/docs-check.mjs#MEMORY_MIRROR_DIR`）。
