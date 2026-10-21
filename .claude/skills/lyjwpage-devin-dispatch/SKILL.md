---
name: lyjwpage-devin-dispatch
description: lyjwpage 云端线程把实现、排查或测量的活派给容器里的 Devin CLI（限额有余用 Fusion High，用完退回免费的 swe-2-max）时用：每任务一个 git worktree，tmux 交互式可中途追加指令，Claude 写任务书、监控、验收，再把 Devin 的提交重新签名进 PR。规格已定、要动多个代码文件或要反复跑命令试错的实现、复现、测量（lyjwpage-delegate 表里归 Devin 的那一档）时用；lyjw 说「派给 Devin」「让 Devin 去做」「给 Devin 追加指令」「续派」时也用。
---

# 云端 Devin CLI 调度

Claude 定方案、写任务书、验收，Devin 动手。Devin 是外部进程：它看不到这段对话，只看任务书；它的自述不是证据。

## 派什么

- 派：方案和验收判据已经写得出来，剩下的只是动手：按给定接口写模块加测试、照方案改一条调用链、造复现命令再修、跑测量出数字。改动跨多个文件或要多轮「跑、看报错、再改」时最划算。
- 不派：还要弄清 lyjw 要什么、做设计取舍；一两个文件的小改（Sonnet 或自己做）；只读归纳（Sonnet）；要联网、要凭据、要碰生产的活（沙箱里做不了）；有 UI 变化的活可以派实现，截图与给 lyjw 看图仍由 Claude 做。

## 选模型

lyjw 的 Devin Pro 订阅就是给 Claude 派活开的，不用给 lyjw 留额度。

- **限额有余用 Fusion High**：`fusion-claude-fable-5-1-high-sidekick-swe-2-medium`，即 `/fusion` 菜单里默认主模型（Claude Fable 5.1）的 High 档，配免费的 SWE-2 Medium 副手。派活前跑 `dv usage`，Daily 和 Weekly 的 `used_pct` 都低于 90 就用它；按量计费，每轮都扣限额。
- **限额用完退回 swe-2-max**：两项任一到 90，或会话停在额度用尽的报错上，新任务用默认的 `swe-2-max`（Free，不扣限额，但有全账号共用的速率桶），跑着的任务在空闲时 `dv model <name> swe-2-max` 换模型接着做，不开新会话。重置时间在 `dv usage` 的 `resets` 里，过了再换回来。
- 并发两种都开约 6 个、其余排队：免费档开多了一起撞速率桶，Fusion 开多了只是更快烧完限额。排队按「已 `start`、还没 `stop`」的会话数算（`dv list` 里不是 `exited` / `gone` 的行），不按 `busy` 算：停在批准菜单、限流中、刚交完活等验收的会话都不显示 `busy`，按忙闲数会一口气放进全部任务。

## 环境

`devin` 由云端环境 `lyjwMain` 的启动脚本装好。PATH 上的 `devin` 是带 `DEVIN_WRAPPER` 标记的 wrapper，真正的程序是 `devin-real`。wrapper 负责这些：

- bwrap 可用时加 `--sandbox`：Devin 的 shell 命令只能写工作区和 git common dir（钩子与 `config` 除外），往别处写拿到 EROFS，沙箱里不能联网。**编辑 / 写文件工具不在沙箱里**：它们跑在 CLI 进程内，能写任何没被 deny 的路径，只靠写前的批准菜单拦（见下文 dv.py）。bwrap 不可用时退回只靠 `permissions.deny` 的 dangerous 模式，并在 stderr 说明。
- `permissions.deny` 禁止 `git push`、`sudo`、`gh`，禁读 Devin 凭据、`~/.ssh`、`~/.gnupg` 和 lyjw 的签名钥，禁写 Devin 配置、`~/.local/bin`、`~/.claude`。这是策略层的拦截，不是隔离；隔离靠沙箱。
- 用 `GIT_CONFIG_*` 让 Devin 的提交不签名。进 PR 前由 Claude 重新签（见「验收与合并」）。
- export `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`：Devin 的用量经 Network secret 鉴权推到 `agents-otlp`，站点标 Cloud（配置见 `docs/ops-facts.md`「Claude Code 云端 routine」）。

不读启动脚本原文，不 `cat` Devin 的 `~/.local/share/devin/credentials.toml`：里面有 lyjw 的签名私钥和 Devin key。

## dv.py

```bash
dv(){ python3 -I .claude/skills/lyjwpage-devin-dispatch/scripts/dv.py "$@"; }   # 云端 shell 是 zsh，DV="python3 …" 加 dv 不分词
dv start <name> --cwd <worktree> --brief <brief.md> [--nice 10] [--model <模型>]   # 不传为 swe-2-max（或 $DV_MODEL）
dv send  <name> -f <followup.md>      # 或 dv send <name> '一句话'；或从 stdin 读
dv wait  <name> --timeout 3600        # 放进 Bash run_in_background；空闲/退出/需要处理/额度用尽时返回，免费档限流时自己等到重置再续
dv approve <name>                     # 批准一次写入菜单；路径不在工作区时拒绝执行
dv deny <name> ['给 Devin 的话']       # 菜单选 No，再告诉它只能写工作区（不给文字时用默认说明）
dv status <name>                      # 状态 + 屏幕尾部 + 导出里最后一条 agent 消息
dv report <name> [-n N | --all]       # 从 --export JSON 读它说的话
dv key <name> Enter                   # 原样按键（回答它的提问 / 选项）
dv interrupt <name>                   # Esc Esc：停当前这一轮，会话保留
dv stop <name>                        # /exit；会话 id 仍可 resume
dv resume <name> -f <next.md>         # tmux 已退出时，无头 `devin -r <id> -p` 续一轮
dv model <name> <模型>                # 空闲时在原会话里 /model 换模型，之后 resume 也用新模型
dv usage                              # 临时开一个 Devin 读 /usage，打印 Daily / Weekly 的 used_pct 与重置时间
dv list
```

- 无头 `resume` 碰到写入菜单会直接拒（非交互，没人批），只能读和跑命令；所以验收（含沙箱外重跑全量 `pnpm typecheck`）通过前不 `stop`，要改文件的续轮用 `send`。
- 在 wrapper 下 `start` 不传 `--mode`，模式由 wrapper 定；要别的模式用 `DV_MODE` 覆盖。
- 沙箱里即使是 dangerous，Devin 用编辑 / 写文件工具前仍会停在批准菜单（`1 Yes (Approve once)` / `2 Yes, allow edits in <目录>` / … / `No`）。这些工具不受沙箱约束，菜单就是边界。在 wrapper 下启动的任务默认 `--auto-approve`：`wait` 取菜单上方最近的 `⏺ Writing <path>` / `Editing <path>`，相对路径按 worktree 解析、`realpath` 去掉 `..` 和符号链接后，落在 worktree 或该仓库的 git common dir（`hooks/`、`config` 除外）里，且第 2 项 `allow edits in <目录>` 是目标文件所在目录（Mac 上的菜单）或 worktree 根（云端沙箱的菜单），才按 Enter 批准一次；同一屏不重复按，计数记在 meta。路径不在范围内、认不出（没有写入标题、被截断、标题后面跟着缩进的折行）或缺 allow 行时不批，`wait` 立即返回 4 并写明原因。
- 返回 4 且原因是 `outside the worktree` 或认不出路径时，默认 `dv deny <name>`：选 No，再告诉它只能写工作区。确需写工作区外的文件，由 Claude 自己写，不替 Devin 批。**不选 always allow，不切 bypass**：那是改 Devin 的持久配置。
- 菜单开着时 `send` 会拒绝（粘贴的文字会落进菜单），先 `approve` 或 `deny`。
- 运行状态在 `$DV_RUNS`（默认 `~/.claude/devin-dispatch/runs`）下按任务名分目录：meta、`--export` 的 JSON（Devin 每轮重写）、退出码。tmux 会话名是 `dv-<name>`。
- `wait` 的返回码：`0` 空闲（打印最后一轮回复），`3` 已退出，`4` 停在提问、菜单、断线重试或认不出的屏幕超过 `--attention` 秒，`5` 额度用尽（`quota`），或限流的重置时间超出 `--timeout` / 读不出，`124` 超时。返回 4 时用 `status` 看屏幕并处理，不能放着：没人回答的提问会让它一直等。返回 5 且是额度用尽时，按「选模型」`dv model <name> swe-2-max` 再 `dv send <name> 继续`。
- **免费档限流**（`ratelimit`）：速率桶全账号共用，所有会话屏幕上是同一个重置时间（`reset in 1 hour 2 minutes (at 06:01 UTC)`），提前重试只会再撞。`wait` 读出重置时间，睡到重置后 30 秒，再发一句续跑，最多每 2 分钟一次；`status` 打印还剩几秒。不用另写轮询脚本。

### 已实测的机制（Devin CLI v3000.11.92）

- **忙时追加**：输入框占位符是「Guide Devin while it works」。发进去的消息在当前工具调用结束后送达，不用等空闲。
- **多行消息**用 tmux 括号粘贴（`load-buffer` + `paste-buffer -p`），隔 1 秒再按 Enter；紧跟文本的 Enter 会被吞掉。`send` 已这样做并核对文本离开了输入框，不要再补按。
- **状态标记**：只看屏幕底部的输入框区域（倒数第二条横线的上一行到底）。忙 = 输入框上一行「Thinking · 1s (esc twice to interrupt)」或占位符「Guide Devin while it works」；空闲 = 占位符「Ask Devin to build features…」；刚启动时它和「Starting session…」同时出现，不算空闲。打开的批准菜单会替换掉输入框：屏幕上最后一个「Approve once」之后没有横线就是 `approval`，最先判。菜单的写入预览和 Devin 读过的文件里可能就有这些标记字样（审计 dv.py 时出现过），所以不能按全屏搜。
- tmux 目标要写成 `=<session>:`（精确匹配加冒号）。
- **限额**：`/usage` 显示账号的 Daily / Weekly 已用百分比和重置时间（Devin Pro）。一轮极短的 Fusion High 对话让 Daily 从 0 到 1%；同样跑一轮 swe-2-max，百分比不动。额度用尽时输入框上方是「▲ Quota exhausted / Your daily usage quota has been exhausted…」，`dv.py` 判为 `quota`，`wait` 返回 5。启动横幅也会写「Pro · N% remaining (resets in …)」。
- **换模型**：空闲时在输入框敲 `/model <模型 id>` 加一次 Enter，屏幕出现「Model set to …」即生效，会话上下文保留。
- **会话 id** 是 `snow-chair` 这类名字，在 worktree 里 `devin list --format json` 能查到，`start` 自动记下。tmux 死了也能 `devin -r <id>` 接上。
- `-p` 立即绑定它后面的参数：`devin -r <id> … -p '<prompt>'` 可以，`devin -p -r <id> …` 报错。长提示用 `--prompt-file`。
- `-p` 的 stdout 只有最后一条 agent 消息；完整过程在 `--export` 的 JSON（`steps[]`，取 `source` 为 `user` / `agent` 且有 `message` 的项）。导出文件即使叫 `.md` 也是 JSON。

## 派活流程

1. **建工作区**（每任务一个，放在会话 scratchpad 下）：`git worktree add <scratchpad>/wt/<task> -b devin/<task> <base-sha>`。沙箱里不能联网：依赖要在派活前由 Claude 在 worktree 里 `pnpm install` 好（沙箱外有网），任务书写明不许装新依赖。再在 worktree 里跑一次 `pnpm typecheck`：它会生成 wrangler 与路由类型，Devin 在沙箱里跑 `tsc` 才看得到真实的类型错误，否则它会把真错误当成「缺生成类型的既有问题」。沙箱会在 worktree 里挂出 .bashrc、.gitconfig、.mcp.json、.idea 这类只在沙箱内可见的占位文件：任务书写明只 `git add <路径>`，不许 `git add -A` / `git add .`；`pnpm rules:check` 在沙箱里读到它们会 EACCES，验收时由 Claude 在沙箱外重跑；`wrangler types` 在沙箱里写不了 `~/.config`，要把 `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` 指进 worktree。
2. **写任务书**：结构见 `references/brief-template.md`。共享规则一份，任务书一份；每条规则写成「不许 X，改做 Y」。
3. **启动**：先 `dv usage` 按「选模型」定模型，再 `dv start <task> --cwd <worktree> --brief <brief.md> --nice 10 --model <模型>`。
4. **挂唤醒器**：每个任务一个 `dv wait <task> --timeout 3600`，交给 Bash `run_in_background`；返回后看码处理，再挂下一个。不用前台 sleep 轮询，不把命令再套进 `( … ) &`（外层立刻结束，通知不来）。
5. **纠偏**：方向错了就 `send` 一段说明（发现了什么、改做什么、为什么）。要它马上停，先 `interrupt` 再 `send`。它一空闲就派下一段，不让它闲着。
6. **收报告**：`dv report <task>`，然后验收。

## 验收与合并

- 读 diff：`git log/diff <base>..devin/<task>`，用 `git -C`，不进它的工作区改东西。
- **自己重跑**改动波及的门禁（根 `AGENTS.md`「项目入口与验证」、`.claude/skills/lyjwpage-verify/SKILL.md`）。Devin 报告里的数字只当线索。
- 查越界：`git stash list`、主检出的 `git status`、`df -h`、它留下的进程（按 PID）、未清的大文件。
- **重新签名进 PR**：Devin 的提交不签名。在 PR 分支上 `git cherry-pick <base>..devin/<task>`，新提交由会话环境以 lyjw 身份签名；不改提交身份、不关签名（根 `AGENTS.md`「禁区」）。尾注统一成 Claude 的 `Co-Authored-By` 加 `Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>`，去掉 Devin 自带的「Generated with」。之后照常开 PR、走合并门槛。
- 提交和 PR 里不许出现 key：推之前 `git diff <base>.. | grep -E '^\+' | grep -E 'eyJ[A-Za-z0-9_-]{20,}|devin-session-token$'` 必须为空（只看新增行；JWT 至少 20 字符，本行说明不会自己命中）。
- 收尾：先 `dv stop` 并确认 `dv list` 里它已退出，再看 worktree 的 `git status`：有没提交的改动就先问清要不要（要的让它续一轮提交，或自己提交），干净了才 `git worktree remove <worktree>`，不加 `--force`；只删该任务目录下的大文件；确定不再续跑的会话 `devin rm --force <id>`（id 在 meta 里；非交互环境不加 `--force` 会报错）。

## 出事怎么办

- **服务断线**（`Connection error … "retryable": true`，退出码 1）：`devin models list` 确认服务回来，再对每个任务 `resume`（tmux 还在就 `send`）一段续跑提示，写明停在哪、哪些输出可能是半截的。不开新会话重派。交互式断线时屏幕显示 `Connection failed (attempt N/4), retrying`，`dv.py` 判为 `neterror`。
- **编排会话重启**：tmux 里的 Devin 不受影响，`-p` 子进程会被一起杀。重启后先 `dv list`。云端容器本身重启时 tmux 和跑着的 Devin 一起没了，正在跑的任务要重派。
- **sandbox 起不来**：wrapper 退回 deny-only 模式并在 stderr 说明。这时没有文件系统隔离，只派不碰仓库外的小任务，并告诉 lyjw。
- **模型价格**：`devin models list` 里 swe-2-max 不再标 Free 时，限额用完的退路就没了，告诉 lyjw。Fusion 本来就扣限额，不用问。

## 硬限制

- Devin 不推送、不开 PR、不部署、不碰 Cloudflare 与 GitHub 设置等生产资源；这些都由 Claude 按仓库规矩做。
- Devin 要凭据（PAT、API key、账号）时一律不给，告诉 lyjw。
- 不替 lyjw 批准 Devin 的持久配置提示（always allow、建个人 skill、切 bypass）。
- 进程只按自己记下的 PID 操作，不 `pkill -f`、不 `pgrep -n`。
- 只用 `&&` 串有前置条件的命令；`;` 会让检查失败后的步骤照样执行。

## 测试

`bash .claude/skills/lyjwpage-devin-dispatch/tests/smoke.sh [workdir]`：在临时仓库上真跑一遍 start → 批准工作区内的写入菜单 → 忙时追加多行 → wait → report → 让它往工作区外写（期望 `wait` 返回 4、文件没生成，再 `deny`）→ interrupt → stop → resume，约 4 分钟，结尾打印批准次数。菜单解析和范围判断的单测：`python3 -I .claude/skills/lyjwpage-devin-dispatch/tests/test_menu.py`，改 `dv.py` 的菜单逻辑后跑。Devin CLI 或 wrapper 变了先跑它：屏幕标记跟版本走。
