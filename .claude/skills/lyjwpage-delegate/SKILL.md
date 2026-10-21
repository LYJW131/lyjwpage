---
name: lyjwpage-delegate
description: lyjwpage 线程里一段活要连着调 5 次以上工具、而结果只需要一句结论或一个文件时用：成批读讨论串、PR 评论、日志、文档，全仓找用法，照规格做的机械改动，拆帧截图，等 CI 与部署；按表派 Haiku / Sonnet 子代理、Devin swe-2 或后台命令，主线程只定做什么、判结果。
---

# 把不需要 Opus 的活派出去

主线程每调一次工具，都要把整段对话上下文重读一遍。一段 20 次调用的机械活放在主线程，就是重读 20 遍；派给子代理，主线程只付写简报和读回报两次。所以：**主线程只做要判断的事，其余按下表派出去。**

验证类（本地门禁、浏览器端到端、合并门槛汇总、上线核对）照 [lyjwpage-verify](../lyjwpage-verify/SKILL.md)，这里不重复。

## 派给谁

| 活 | 交给 | 例 |
| --- | --- | --- |
| 纯等待：CI、Workers Builds、`/api/version` 跟上 | 后台命令，不用模型：`Bash(run_in_background: true)` 包 `timeout`，或 `scripts/deploy-check.ts --timeout` | 等 CI 结束再决定下一步；要核对生产行为、签回执的上线核对照 lyjwpage-verify |
| 等完还要看一眼：CI 红了读日志摘出报错 | Haiku high | 「等 #N 的检查结束，红了贴失败步骤末 40 行」 |
| 照固定清单跑命令、截图、拆帧、拼图、抓多页数据存成文件 | Haiku high | ffmpeg 抽帧加帧差；Observability 翻 6 页存 TSV |
| 成批读再归纳：讨论串、会话记录、PR 评审、Gmail、长文档、外部文章 | Sonnet medium | 读 30 条评审列出未回复的；读 10 个线程找反复出现的做法 |
| 全仓找用法、找旧说法、列调用方 | Sonnet medium（`Explore` 也行） | 「改名前列出所有读 `X` 的地方」 |
| 规格写清、要动多个代码文件或要反复跑命令试错的实现：按给定接口写模块加测试、照方案改一条调用链、复现 bug 并修、跑测量对比 | Devin（限额有余用 Fusion High，否则 swe-2-max），照 [lyjwpage-devin-dispatch](../lyjwpage-devin-dispatch/SKILL.md) | 照规格写 `revert-proof.ts` 与测试；造复现命令再修 |
| 规格写清的小改动：批量改名、同步文档措辞、改一两个文件 | Sonnet high，`isolation: "worktree"` | 改名后同步所有文档引用 |
| 弄清 lyjw 要什么、设计取舍、找根因、读 diff 判对错、合并与否、给 lyjw 的回复 | 主线程自己 | |

拿不准时往上一档（Haiku → Sonnet → 主线程），不往下。

## 派法

```
Agent(
  description: "<模型> <做什么>",
  subagent_type: "general-purpose",
  model: "haiku" | "sonnet",   // 必须写：不写就继承主线程，等于又派了一个 Opus
  effort: "high" | "medium",
  run_in_background: true,     // 下一步非等它不可才用 false
  prompt: <简报>
)
```

简报五项，子代理看不到对话，每项都写：

1. 禁区：不调用 `mcp__hearthbot__` 的写工具（`reply`、`update_status`、`react`、`set_thread_resolved` 等）；读讨论串的活写明可用 `fetch_thread`、`fetch_messages`、`list_thread_sessions`；不推送、不合并、不在 GitHub 上评论、不改 Cloudflare 与生产。只读的活写明「只读」。
2. 要什么：目标一句话，加上做完的判据（「列出全部未回复线程」，不是「看看评审」）。
3. 材料：仓库、分支、PR 号、文件路径、会话或线程 id、要用的脚本，写全，不让它自己去猜。
4. 产物：长结果写进 `/mnt/project-files/<主题>/` 或会话 scratchpad 的文件；回报不超过 10 行，写文件路径、结论、没做到的及原因。
5. 守规矩：要遵守的仓库规则原文贴进去（比如共享目录先读再改、不手跑 `wrangler deploy`）。

## 派出去以后

- 互不依赖的几份活一次并行派出。
- 等的时候做别的，或结束回合；回报到了会唤醒你。不在主线程用 `ReadNotifications`、`sleep` 一遍遍查。
- 回报到了，抽查一处（打开一张图、核一个数、读一段原文），不重做一遍它读过的东西。
- 回报说没做完：让同一个子代理把已有的先写成文件再报，缺的部分再派或自己补，不从头重派。

## 不派的情况

- 一两次调用就完的事：写简报比自己做还贵。
- 结果要靠这段对话里的上下文才判得准，且说不清楚判据。
- 写操作落在仓库外：评论、合并、改设置、发消息，由主线程自己做。

## 坑

- Haiku 的上下文小：给它「把某个会话的事件全部翻完」这种没有上限的分页，它会读到一半没空间。成批读给 Sonnet，或者要求每读一页就把摘要追加进文件。
- 写代码的子代理用 `isolation: "worktree"`，免得和主线程抢同一个工作区；改完由主线程看 diff、跑门禁再提交。
