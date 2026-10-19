---
paths:
  - "reporters/**"
  - ".github/workflows/build-reporters.yml"
  - ".github/workflows/release-mac-telemetry-hub.yml"
---

# 上报器发布

- 上报器与其他独立部署单元按各自 README 发布：misaka-jp 上的 `server-reporter`、`agents-reporter`、`discord-reporter` 合进 main 后由 `.github/workflows/build-reporters.yml` 自动换镜像，dsm 上的 `emby-reporter`、n100 上的 `playstation-reporter` 手动。若依赖站点的新契约或更长陈旧窗口，先确认站点及 Worker 契约已生效，再切换上报器，最后验证真实上报与站点读取。
- `reporters/mac-telemetry-hub` 是 git submodule，指向 `LYJW131/MacTelemetryHub`，不会自动跟随远端。Hub 仓库推送后，站点仓库的子模块指针要挪到同一提交，否则站点里的上报器源码停在旧版本；指针推到 main 即触发 Hub 的签名与公证 Release（`.github/workflows/release-mac-telemetry-hub.yml`）。跨两个仓库的同一件事（如新契约两边同时改）把指针挪动并进站点那次提交，一次提交说完整件事；站点本身没改动时才单独提 `chore(reporters): 更新 mac-telemetry-hub，<改了什么>`。Hub 本机安装走它自己的 `reporters/mac-telemetry-hub/build-release.sh`，与指针更新是两件事。
