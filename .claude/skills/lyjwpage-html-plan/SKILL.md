---
name: lyjwpage-html-plan
description: lyjwpage 里给 lyjw 出要拍板的计划时用：有要 lyjw 定的分叉、又不止一步的改动，不发长消息，用原版 html-plan 插件写成一页交互式计划书，lyjw 在页面上作答、一次交回。lyjw 说「出个计划书」时也用。本文件只写 lyjwpage 和原版不同的地方。
---

# 交互式计划书（原版 html-plan 加本项目约定）

计划书用 Thariq 的 html-plan 插件写，`.claude/settings.json` 的 `enabledPlugins` 已启用 `html-plan@claude-community`。先照插件的 skill `html-plan:html-plan` 做，它的树、展品、决定、打包脚本和读答复的规矩全部照用。原版和本文件冲突时以原版为准，下面列出的几条除外。

会话里没有这个 skill 时先装上：

```sh
claude plugin marketplace add anthropics/claude-plugins-community --scope project
claude plugin install html-plan@claude-community --scope project
```

## 什么时候用

- 计划里有要 lyjw 定的分叉，且不止一步。小事照旧直接做，一条消息说得完的也不用。
- lyjw 说「出个计划书」。
- 不用于汇报和调研：那些照项目记忆 report-book-style 发书页 Artifact。

## 和原版不同的地方

- 正文写中文，照 HUMAN.md「7」的 STE 式短句：一句一事、主动句、一个词只指一件事。原版的 STE 用词表只管英文，打包脚本对中文不报 STE 警告，句子长短自己把关；它对中文主张报的「write a full sentence with a verb」是误报。代码、文件名和界面草图里的文字照原样。
- 第三人称写 lyjw，时间写 SGT。`doc-quote` 引 lyjw 的原话，不改写。
- 页面和打包产物放 `/mnt/project-files/html-plan/`。打包带仓库根当 `--root`，并加 `--artifact`：

  ```sh
  node <插件 skill 目录>/runtime/pack.mjs /mnt/project-files/html-plan/<名字>.html --root . --artifact
  ```

  页面 `<head>` 里加一行 `<style>html body { background: var(--paper); color: var(--ink); }</style>`：Artifact 外壳会给 body 涂浅色底，原版只给 html 上底色，深色模式下就成了浅底配浅字。用 Artifact 发布生成的 `<名字>.artifact.html`。同一份计划改版用同一个文件路径重发，链接不变。发布前看一眼 pack 列出的「code from … is now inside the page」，不该进页面的文件不放。
- 交接：线程里发一句话加链接，说几个决定、默认怎么走。lyjw 按 Respond、Copy response，把答复贴回线程。
- 等答复时照根 `AGENTS.md`「工作方式」：照默认项先做能撤回的部分（建分支、写代码、开草稿 PR），不可撤回的等答复。这条替代原版的「答复到之前不动手」。
