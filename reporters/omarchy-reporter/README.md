# omarchy-reporter

把这台 Omarchy（Hyprland）机器的前台应用推给 lyjwpage 的桌面应用，对应 Mac 上的 Mac Telemetry Hub。Go 写，界面用 [MyGo](https://github.com/egoist/mygo) 的原生 UI：主窗口「概览」看当前前台应用和上报情况、暂停上报、开关登录自启，「设置」填上报地址与 Access 凭据；关窗口留在托盘，托盘菜单能重新打开、暂停、退出。站点目前只收不展示。

## 它做什么

| 内容 | 什么时候推 |
| --- | --- |
| 前台窗口：应用名、`appId`（Hyprland class）、窗口标题、工作区 | 监听 Hyprland 的事件 socket（`.socket2.sock`），焦点、工作区变化后约 0.3 秒取一次 `j/activewindow`；换了应用或工作区立刻推，只改标题的最多每 `titleInterval` 推一次（终端和 agent 的标题每秒都在转圈） |
| 心跳 | 每 `heartbeatInterval` 把当前状态再推一遍，站点按 `shared/omarchy.ts#OMARCHY_STALE_MS` 判断在不在线 |
| 没有聚焦窗口 | `desktop: null` |

应用名取自 `.desktop` 文件的 `Name`：先找 `StartupWMClass` 等于 class 的，再找文件名等于 class 的，都没有就用 class 本身。暂停期间什么都不推，站点那份过了陈旧窗口就当不在线。

入口 `/api/ingest/omarchy`，权限 `ingest:omarchy`，信封 `{ version: 1, observedAt, modules: { desktop } }`，校验见 `shared/ingest/omarchy.ts#prepareOmarchyReport`。

## 配置

在主窗口「设置」里填，保存后上报按新设置重启。设置存在 `~/.config/lyjwpage/omarchy-reporter.env`（权限 0600，环境变量同名覆盖）：

```sh
ACCESS_CLIENT_ID=xxxx.access
ACCESS_CLIENT_SECRET=xxxx
# SITE_INGEST_URL=https://ingest.homepage.lyjw.llc/api/ingest/omarchy
# DRY_RUN=true   # 只把信封打到 stderr，不推
```

凭据是 Access service token `lyjwpage-omarchy`，只授予 `ingest:omarchy`。没配凭据时照常采集、在窗口里显示，只是不推送。

## 构建与运行

要 Go（版本见 `go.mod`）和 `libayatana-appindicator`（Omarchy 自带）。

```sh
cd reporters/omarchy-reporter
go test ./...
go build -ldflags '-s -w' -o build/omarchy-reporter .
DRY_RUN=true ./build/omarchy-reporter   # 试跑
./install.sh   # 装到 ~/.local/bin，并写启动器条目 omarchy-reporter.desktop
```

从启动器打开装好的那份，再在窗口里打开「登录时启动」：XDG 自启项记的是启动时的路径，自启时只进托盘。
