---
name: lyjwpage-mac-session
description: 云端线程要借 lyjw Mac 上的 Remote Control 会话做事时用：灌 Secret、用 lyjw 账号 gh 改仓库设置、AGENTS.md 允许的那次手动 wrangler deploy、ssh 到自家机器、对着 Mac 侧边浏览器调 UI。管简报怎么写、自动模式拦了怎么办、回报怎么核对。
---

# 借 lyjw Mac 上的 Remote Control 会话

Mac 会话有 lyjw 的 checkout、登录态和凭据，云端没有。代价是它看不到云端线程的对话，跑在会拦写操作的自动模式里，还会掉线。

## 什么时候去 Mac

- 去：凭据（灌 Worker Secret、用本机文件里的 key），要 lyjw 账号权限的 `gh` 写操作（分支保护、仓库合并设置），AGENTS.md「禁区」里唯一允许的手动 `wrangler deploy`（agent 发出的部署命令会被仓库的 PreToolUse 钩子拦下，Mac 会话也一样：简报里写好完整命令，请 lyjw 在那个会话的输入框用 `!` 前缀自己跑，再由 Mac 会话读回核对），ssh 到 misaka-jp、dsm、n100，lyjw 要对着 Mac 侧边浏览器实时调 UI。
- 不去：真模型试跑先用云端会话环境变量里的 Anthropic key（变量名见项目记忆 cloud-env-gaps）；Cloudflare 只读查询走 Cloudflare MCP。
- 文件夹用 `list_devices` 里已批准的那个，照列出的绝对路径传给 `start_rc_session`。

## 简报

Mac 会话只看得到简报。只交给它这一步，不要把线程的原始需求整段转过去，否则它会把整件事在 Mac 上重做一遍。简报逐条写：

1. **身份**：你是哪个云端线程的助手（写线程标题和要回报的会话 id；本会话的 id 用 claude-code-remote 的 `get_session` 不传参数读），只做下面这一件事。
2. **起点**：要用到仓库代码时，写分支与提交 sha，在独立 worktree 里做：先 `git fetch origin <分支>`，再 `git worktree add --detach ../lyjwpage-<事> <sha>`，进去核对 `git rev-parse HEAD`；只调 API 的步骤不用 worktree。无论哪种都不动 lyjw 现有 checkout 的分支和文件。
3. **步骤**：精确命令，按顺序。改 UI 时把 lyjw 在本线程里对这块已经说过的要求（删掉的、不要的、指定的尺寸和样式）逐条抄进去，Mac 会话看不到它们。会改东西的那条写明「只跑一次；失败不重试、不改参数，原样回报」。
4. **禁区**：不读、不打印、不 `cat` / `echo` 任何凭据、`.dev.vars` 或环境变量值；凭据按文件名定位，用管道写进去（`wrangler secret put <名> -c wrangler.toml < <文件>`）。不动其他 Worker，不删云端资源，不提交不推送（除非这一步就是推送）。被自动模式拦下就停，直接回报，不要绕开。
5. **读回**：改完用读接口读回，和改前逐字段对比（`gh api` 读回 JSON、`wrangler secret list` 只看名字）。
6. **回报**：用 `send_message` 发给云端会话：执行的 sha、完整命令输出（凭据除外）、读回结果。在线程里最多发一行中文。
7. **收尾**：删掉 worktree。

收到回报后，云端能读的就自己再读回一次（例如 `gh api` 的只读接口），读不到就在回复里写明以 Mac 的读回为准。这件事做完、不再需要 Mac 时 `stop_rc_session`。

## 自动模式拦了

写 Secret、改仓库设置、生产部署、改 Cloudflare 配置都可能被 Mac 的自动模式拦下，lyjw 在云端线程里说过同意也照拦：那里的放行只认 lyjw 在 Mac 会话里亲口答应。

1. 回复里先写要 lyjw 做什么，一句话：去 Mac 会话那边回一句放行，或者在那个 Mac 会话的输入框里用 `!` 前缀直接跑你给的完整命令（这样走 lyjw 自己的 shell，不经自动模式；凭据照样走管道）。
2. Cloudflare 控制台类操作放行后仍被拦：把每一步点哪里、填什么写进 `/mnt/project-files/<主题>/` 下的说明，附在回复里；lyjw 做完，再用 API 读回核对。
3. 放行后，把旧回复里「需要你回一句…」用删除线改掉，写上已完成。

## 掉线

Mac 会话会休眠或掉线，设备回来后同一会话会恢复。不要因为一时没回应就把同一份简报再 `start_rc_session` 一遍；lyjw 说「重连」或会话确认已结束，才重新开。
