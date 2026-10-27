# scripts/cloud

云端环境 `lyjwMain` 的启动脚本按功能拆成几份放在这里，环境里的 Setup script 只留一个薄壳：开头明文写变量，再现场拉 `setup.sh` 执行。机密只出现在环境的 Setup script 里，不进仓库。

| 文件 | 功能 | 用到的变量 |
| --- | --- | --- |
| `setup.sh` | 入口：并行拉下面四份，按顺序执行；`signing.sh`、`browser-trust.sh` 失败整体退出，`devin.sh` 失败只告警，`claude-user.sh` 失败忽略 | `LYJW_SETUP_REF`（可选，默认 `main`，试分支时指向分支名） |
| `signing.sh` | 装 lyjw 的 SSH 提交签名钥并开 `commit.gpgsign`，写全局 `user.name` / `user.email` | `GIT_SIGN_KEY_B64`、`GIT_SIGN_NAME`、`GIT_SIGN_EMAIL` |
| `browser-trust.sh` | 让 Chromium / Playwright 信任出口代理的 CA，并装 WebKit | 无 |
| `devin.sh` | 装 Devin CLI、写登录凭据、套沙箱 wrapper、配 OTLP 上报 | `DEVIN_SESSION_TOKEN` |
| `claude-user.sh` | 装 `tokens-cli`、写 `~/.claude/settings.json`（源 `claude-user-settings.json`）、把仓库 skill 软链进 `~/.claude/skills/`、`.claude/rules/*.md` 软链进 `~/.claude/rules/`（用户级 SessionStart 钩子也做同样的链接） | 无 |

## 环境 Setup script 的内容

```bash
#!/bin/bash
set -euo pipefail

export GIT_SIGN_KEY_B64='<签名私钥的 base64>'
export DEVIN_SESSION_TOKEN='<devin-session-token$...>'
export GIT_SIGN_NAME='<提交署名>'
export GIT_SIGN_EMAIL='<提交邮箱>'

curl -fsSL --retry 2 --max-time 30 "https://raw.githubusercontent.com/LYJW131/lyjwpage/${LYJW_SETUP_REF:-main}/scripts/cloud/setup.sh" -o /tmp/lyjw-setup.sh
bash /tmp/lyjw-setup.sh
```

- 变量值用单引号：Devin 令牌里有 `$`。
- 脚本从 GitHub raw 现拉，只认已合进 `main`（或 `LYJW_SETUP_REF` 指的分支）的版本。
- 提交身份实际生效的是环境变量 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`，见 [ops-facts.md](../../docs/ops-facts.md)。
- `.claude/rules/*.md` 软链进 `~/.claude/rules/` 后，讨论串是否会按 `paths` 载入这些规则未核实，改匹配文件前仍直接打开读（见根 `AGENTS.md`）。
