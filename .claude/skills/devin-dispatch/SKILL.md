---
name: devin-dispatch
description: >-
  Dispatch implementation, measurement or investigation tasks to the local Devin CLI (`devin`,
  default model swe-2-max) as a worker, one git worktree per task, steer it mid-run by appending
  input, and review/verify/merge what it produces. Use when the user says 派给 Devin / 让 Devin 去做 /
  用 Devin CLI 当执行者 / 续派 / 给 Devin 追加指令 / 纠偏, or hands over a multi-task sprint where
  Devin is the executor. 本地 Devin CLI 调度最佳实践：tmux 交互式（可追加输入）或 -p 无头，任务书、
  监控、续跑、验收、合并。Claude 保留架构决策和验收责任。
argument-hint: "<任务名> <任务描述或任务书路径>"
user-invocable: true
---

# Devin CLI 调度

你是架构师和验收人，Devin 是执行者。Devin 是外部进程：它看不到这段对话，只看任务书；它的自述不是证据。

Request: $ARGUMENTS

## 两种跑法，怎么选

| | tmux 交互式（`dv.py`，默认） | `-p` 无头 |
|---|---|---|
| 追加输入 | **能**：忙时发的消息排队，到它下一个工具步骤边界送达 | 不能；只能等它退出后 `-c`/`-r` 续一轮 |
| 退出通知 | 用 `dv.py wait` 放后台当唤醒器 | Bash `run_in_background` 直接通知 |
| 适合 | 可能要纠偏的、长的、要回答它提问的任务 | 一次性、边界非常清楚的任务 |

用户 2026-10-12 的原话："你为什么不用交互式"。`-p` 纠偏只能 kill + restart，丢掉进行中的工作。**默认用交互式。**

## dv.py：交互式调度工具

```bash
DV="python3 -I ~/.claude/skills/devin-dispatch/scripts/dv.py"
$DV start <name> --cwd <worktree> --brief <brief.md> [--mode dangerous] [--nice 10] [--model swe-2-max]
$DV send  <name> -f <followup.md>      # 或: $DV send <name> '一句话'；或从 stdin 读
$DV wait  <name> --timeout 3600        # 放进 Bash run_in_background；空闲/退出/需要处理时返回
$DV status <name>                      # 状态 + 屏幕尾部 + 导出里最后一条 agent 消息
$DV report <name> [-n N | --all]       # 从 --export JSON 读它说的话
$DV key <name> Enter                   # 回答审批菜单 / 选项（tmux 键名）
$DV interrupt <name>                   # Esc Esc，停当前这一轮，会话保留
$DV stop <name>                        # /exit；会话 id 仍可 resume
$DV resume <name> -f <next.md>         # tmux 已退出时，无头 `devin -r <id> -p` 续一轮
$DV list
```

运行状态在 `$DV_RUNS`（默认 `~/.claude/devin-dispatch/runs`）`/<name>/`：`meta.json`（含 Devin 会话 id）、`export.json`（Devin 每轮结束重写一次）、`exit.code`、`resume.out`。tmux 会话名 `dv-<name>`；让用户旁观就在 Terminal 面板开一个 tab 跑 `tmux attach -t dv-<name>`。

`wait` 的返回码：`0` 空闲（打印最后一轮回复）、`3` 已退出、`4` 屏幕停在提问、审批菜单、断线重试（`neterror`）或无法识别的状态超过 `--attention` 秒（用 `status` 看屏幕）、`124` 超时。返回 4 时**必须处理**：2026-10-13 Devin 在一个采样问题上等了很久没人回答，直到用户发现（"devin问你话你看到没"）。

### 已实测的机制（Devin CLI v3000.11.92，2026-10-20）

- **忙时追加**：输入框占位符是 "Guide Devin while it works"。发进去的消息先显示在对话里，在它当前工具调用结束后送达，它会接着处理。不用等空闲。
- **多行消息**用 tmux 括号粘贴（`load-buffer` + `paste-buffer -p`），换行留在输入框里不会提前发送；然后**隔 1 秒**再按 Enter。紧跟在文本后面的 Enter 会被吞掉（`/exit` 实测需要第二次 Enter）。`send` 已经这么做，并检查文本离开了输入框；不要盲目再按一次。
- **状态标记**：忙 = "Guide Devin while it works" / "esc twice to interrupt"；空闲 = 占位符 "Ask Devin to build features…"；刚启动时空闲占位符和 "Starting session…" 同时出现，不算空闲。
- **审批菜单**（非 dangerous 模式下跑 shell 命令时）：`1 Yes (Approve once)` … `8 No`，光标默认在 1，`key <name> Enter` 即批准一次。**不要选 3/4（"always allow"）或 5（"switch to bypass mode"）**：那是改用户的持久配置。
- tmux 目标要写成 `=<session>:`（精确匹配 + 冒号），`-t =dv-x` 对 capture-pane 会报 not found。
- **会话 id** 是 `snow-chair` 这类名字，`devin list --format json`（在 worktree 里）能查到；`start` 自动记进 meta。tmux 死了也能 `devin -r <id>` 接上，上下文完整。
- **`-p` 立即绑定它后面的参数**：`devin -r <id> … -p '<prompt>'` 可以；`devin -p -r <id> … '<prompt>'` 报 `cannot be used with '[PATH]...'`。长提示用 `--prompt-file`。
- `-p`（含 `-c`/`-r`）的 stdout 只有最后一条 agent 消息；完整过程在 `--export` 的 JSON：`steps[]`，取 `source in ('user','agent')` 且有 `message` 的项。
- 交互式也带 `--export <路径>`，它每轮结束重写一次，`wait`/`report` 读它而不是刮屏幕。

## 派活流程

1. **建工作区**（每任务一个，放在本会话 scratchpad 里，不 `cd` 出会话目录）：
   ```bash
   git -C <repo> worktree add $S/wt/<task> -b devin/<task> <base-sha>
   ```
   在桌面 app 里，Bash `cd` 进会话目录以外的地方（包括 `.claude/worktrees/` 兄弟目录）会弹 "allow this bash"，bypass 模式也弹；无人值守时一个弹框能卡住一整夜（2026-10-13 卡了约 7 小时）。`tmux -c <dir>`、`git -C`、`subprocess(cwd=…)` 不触发。
2. **写任务书**：结构见 `references/brief-template.md`。共享规则一份、任务书一份；每条规则写成"不许 X，改做 Y"。
3. **启动**：`$DV start <task> --cwd $S/wt/<task> --brief $S/briefs/<task>.md --mode dangerous --nice 10`。
   - `--mode dangerous` 才能无人值守跑完；默认 `accept-edits` 每条 shell 命令都要批准。Claude Code auto 模式可能拦截 dangerous 启动：那就请用户批准或切 bypass 模式，**不要改写命令绕过分类器**。
   - 同时跑 ≤3 个要测性能的任务（多了 CPU 数据全是噪声；load 12–62 时 fps 掉到 40–55）。纯编码任务可以更多。
4. **挂唤醒器**：每个任务一个 `$DV wait <task> --timeout 3600`，Bash `run_in_background`。返回后看码处理，再挂下一个。不要用前台 sleep 轮询。
5. **纠偏**：发现它方向错了，就 `send` 一段说明：发现了什么、要它改做什么、为什么。忙的时候发出去的消息只会排队，不会打断当前这一步。如果要它马上停下来，先 `interrupt`（屏幕会显示 "✱ Canceled. What should Devin do?"，上下文保留），再 `send`。用户原话："这个SWE-2Max别让他闲着了"。它一空闲，就用 `send` 派下一段工作，不要让它闲着等。
6. **收报告**：`$DV report <task>`。然后进入验收。

## 验收：自述不是证据

- 读 diff：`git -C <repo> log/diff <base>..devin/<task>`，不要 cd 进它的工作区。
- **自己重跑**构建、测试和项目的回归检查（Straylight：`$S/we/accept.sh`）。Devin 报告里的数字只当线索。它的工具链可能和本机不同（云端 VM 是 Swift 6.3.3 native，本机 6.4 swiftbuild）。
- 检查它是否越界：`git stash list`（它动过用户的 stash）、`git status` 在用户主检出、磁盘 `df -h`、遗留进程（只按 PID 查）、未清的大文件。
- 署名：Devin 默认在提交里加 `Generated with [Devin]` 和 `Co-Authored-By: Devin <…>`。合并前统一修成项目要求的尾注（Straylight：Claude + `Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>` 两行），推送只走带检查的脚本（Straylight：`$S/we/push.sh`，只快进、查尾注）。2026-10-14 一个 `;` 让推送绕过检查，三条错误尾注上了 main，事后不得不重写历史。
- 合并后：删工作区（`git worktree remove --force`）、只删 `$S/<task>/` 下的大文件、更新共享规则里的 "main 是哪个提交"、`$DV stop`。确定不再续跑的会话用 `devin rm --force <id>` 删掉（id 在 `meta.json`）。非交互环境下不加 `--force` 会报错。

## 出事怎么办

- **服务断线**（`Error: Agent error: Connection error … "retryable": true`，所有代理同时 exit 1）：`devin models list` 确认服务回来了，然后对每个任务 `resume`（或 tmux 还在就 `send`）一段续跑提示（模板见 references），说清停在哪一步、哪些输出可能是半截的。
- **编排会话重启**：交互式 Devin 在 tmux 里，不受影响；`-p` 子进程和它起的测量会被一起杀掉。重启后先 `$DV list`。
- **scratchpad 被清空 / 换了新会话**：路径写死的脚本要先改 `S=`；`git worktree prune` 后才能重新 `worktree add` 同名分支；Devin 会话还在（`devin list` 按目录查，目录没了就查不到），查不到时新任务书写明从哪份报告接手。
- **模型价格**：派活前跑一次 `devin models list` 看 swe-2-max 是否仍标 Free（2026-10-20 仍是 Free；文档曾说 10-15/16 结束）。变成收费就先问用户。

## 踩过的坑

调度侧（你自己）：
- **`( … ) &` 套在 `run_in_background` 里**：外层调用立刻结束，完成通知永远不来。直接把命令交给 `run_in_background`；批量派活写一个 `launch.sh`，里面 `&` 加 `wait`，再把整个脚本交给 `run_in_background`。
- **`-p` 失败不等于任务失败**：最后一行是 `Error: Agent error: Connection error … "cognition.ai/retryable":true`，退出码 1，是网络断了。用续跑提示 `-c`/`-r` 接着做，不要开新会话重派（重派要重读整个代码库）。交互式断线时屏幕显示 `Connection failed (attempt N/4), retrying`，期间发的消息不会执行；`dv.py` 把它判为 `neterror`。
- **`--export` 文件名叫 `.md` 也是 JSON**（ATIF：`schema_version, session_id, agent, steps[], final_metrics`）。读之前先 `ls -l`，长任务的导出可能很大。
- **`--sandbox` 不能用于 SwiftPM 项目**：它忽略 permission-mode，并且和 SwiftPM 自己的 sandbox-exec 嵌套冲突，编译失败。
- **自动压缩之后**，任务书会在 transcript 里再出现一次，这不是你重复发送的。
- 更底层的数据：`~/.local/share/devin/cli/sessions.db`（sessions / message_nodes / tool_call_state 表）、`transcripts/`、`logs/`、`summaries/`。
- 给已经在跑的代理降优先级：对整棵进程树执行 `renice 10 -p <pids>`。新启动的用 `--nice 10`。
- 只能用 `&&` 串联有前置条件的命令。`;` 会让检查失败之后的步骤照样执行（推送事故就是这么来的）。

执行侧（写进共享规则，`references/brief-template.md` 已包含）：
- `git stash` 一律禁止，stash 栈和用户的主检出共享。代理执行过 stash/pop/drop，把用户的 stash 弄丢过一次。
- 进程只能按自己记下的 PID 操作。`pgrep -n` 或 `pkill -f` 会杀掉、或者测错别的代理的进程。
- 大文件只能写到 `$S/<task>/`，并且自己清理。五个代理一起跑时，磁盘曾经只剩 157 MB。清理的范围也要写明：用 `find … -delete` 扫整个 scratchpad，会连 worktree 里被跟踪的文件一起删掉。
- 项目特有的环境陷阱，要把**完整命令**写出来。例如 Straylight 的 `codesign -fs -` 会剥掉 JIT entitlement，计时会慢 3 倍，有个代理因此追了好几个小时不存在的回归。
- 报告必须附带命令原文、退出码和计数。只写"测试通过"的话，可能其实只跑了一部分。
- 共享规则在 r5→r7 之间从 5.7 KB 涨到了 12.4 KB。新规则要**替换**旧规则，不能一直往后追加。
- "Why" 这一节要给数据（峰值、帧数、占比），不要只写"要优化"。有了数据，代理会自己选测量手段。

## 不做的事

- 不回答 Devin 索要凭据的请求（GitHub PAT、Apple 账号等），通知用户。
- 不替用户批准 Devin 的持久配置提示（"always allow"、"Create personal skill"、切 bypass）。
- 不让任务碰用户主检出、已安装的 app、用户数据目录。
- Devin 云端会话（app.devin.ai）是另一套机制，见记忆 `devin-advisor-direct-send`；本 skill 只管本地 CLI。

## 测试

`zsh ~/.claude/skills/devin-dispatch/tests/smoke.sh [workdir]`：在临时仓库上真跑一遍 start → 忙时追加多行 → wait → report → interrupt → stop → resume，约 3 分钟。**Devin CLI 升级后先跑它**，屏幕标记跟版本走。
