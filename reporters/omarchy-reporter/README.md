# omarchy-reporter

把这台 Omarchy（Hyprland）机器的前台应用推给 lyjwpage 的桌面应用，对应 Mac 上的 Mac Telemetry Hub。Go 写，界面用 [MyGo](https://github.com/egoist/mygo) 的原生 UI：主窗口「概览」看当前前台应用和上报情况、暂停上报、开关登录自启，「设置」填上报地址与 Access 凭据；关窗口留在托盘，托盘菜单能重新打开、暂停、退出。站点目前只收不展示。

## 它做什么

| 内容 | 什么时候推 |
| --- | --- |
| 前台窗口：应用名、`appId`（Hyprland class）、窗口标题（只报判断放行的，见下）、工作区 | 监听 Hyprland 的事件 socket（`.socket2.sock`），焦点、工作区变化后约 0.3 秒取一次 `j/activewindow`；换了应用或工作区立刻推，只改标题的最多每 `titleInterval` 推一次（终端和 agent 的标题每秒都在转圈） |
| 心跳 | 每 `heartbeatInterval` 把当前状态再推一遍，站点按 `shared/omarchy.ts#OMARCHY_STALE_MS` 判断在不在线 |
| 应用图标 | 随前台窗口一起：`iconHash` 每次都带，`iconObjectKey` 等图标传进 R2 图片桶后才带，传完立刻再推一次 |
| 没有聚焦窗口 | `desktop: null` |

应用名取自 `.desktop` 文件的 `Name`：先找 `StartupWMClass` 等于 class 的，再找文件名等于 class 的，都没有就用 class 本身。

图标取同一个 `.desktop` 的 `Icon=`（没有就拿 class 当图标名），按当前图标主题、它继承的主题、hicolor、`/usr/share/pixmaps` 的顺序找，同一主题里 SVG 优先、其次最大的 PNG；SVG 用 `rsvg-convert` 栅格化，统一缩成 `icon.go#iconSize` 见方的透明底 PNG。对象键是 PNG 内容的 SHA-256 加 `.png`，先 HEAD、桶里没有才 PUT，和 [emby-reporter](../emby-reporter/README.md) 一样用只能写图片桶的密钥直传，不经过站点。暂停期间什么都不推，站点那份过了陈旧窗口就当不在线。

入口 `/api/ingest/omarchy`，权限 `ingest:omarchy`，信封 `{ version: 1, observedAt, modules: { desktop } }`，校验见 `shared/ingest/omarchy.ts#prepareOmarchyReport`。

## 窗口标题判断

和 Mac Telemetry Hub 同一套：标题先规范化（剥转圈字符、进度、百分比、未读角标、末尾的应用名，`titlenorm.go`），再问 [TypeSafe](https://www.typesafe.ai/) 的 Jev 六道是非题（密钥凭据、私人事务、工作机密、成人内容、政治敏感、信息量，`jev.go`），按 `jev.go#standardThresholds` 落成已公开 / 已锁定 / 待确认 / 已省略。题面与阈值逐字照搬 Mac 版（那边按这串字实测过），改字要重测。

- 只有「已公开」和免判名单里的应用的标题进信封；锁定、待确认、省略、判断失败、没配 TypeSafe API Key 都报 `windowTitle: null`。
- 判断记录按 App ID + 规范化标题缓存在 `~/.local/state/lyjwpage/omarchy-window-titles.json`（最多 500 条），同一条只问一次；失败不入缓存，429 / 5xx 指数退避，最多重试 4 次。
- 新标题判断期间，同一应用上一条已公开的标题最多沿用 20 秒，站点那行字不闪。
- 「待确认」弹桌面通知，点开到主窗口「窗口标题」页，每条可以手动公开、锁定或重判；手动的结论压过模型。
- 总开关关掉就不判、不报；黑名单里的应用标题不判、不报；免判名单直接上报。

数据去向：除了站点上报入口和 R2 图片桶，未判过的规范化标题连同应用名、App ID 会发给 TypeSafe（`api.typesafe.ai`），只在配了 TypeSafe API Key 时发生。

## 配置

在主窗口「设置」里填，保存后上报按新设置重启。设置存在 `~/.config/lyjwpage/omarchy-reporter.env`（权限 0600，环境变量同名覆盖）：

```sh
ACCESS_CLIENT_ID=xxxx.access
ACCESS_CLIENT_SECRET=xxxx
# SITE_INGEST_URL=https://ingest.homepage.lyjw.llc/api/ingest/omarchy
# DRY_RUN=true   # 只把信封打到 stderr，不推，也不传图标
# 四项都填才上传图标，否则只报 iconHash
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
# 窗口标题判断，见上
TITLE_REPORTING=true
TYPESAFE_API_KEY=
TITLE_BLACKLIST=org.telegram.desktop
TITLE_TRUSTED=
```

凭据是 Access service token `lyjwpage-omarchy`，只授予 `ingest:omarchy`。没配凭据时照常采集、在窗口里显示，只是不推送。

## 构建与运行

要 Go（版本见 `go.mod`）、`libayatana-appindicator` 和 `rsvg-convert`（Omarchy 都自带）。

```sh
cd reporters/omarchy-reporter
go test ./...
go build -ldflags '-s -w' -o build/omarchy-reporter .
DRY_RUN=true ./build/omarchy-reporter   # 试跑
./install.sh   # 装到 ~/.local/bin，写启动器条目 omarchy-reporter.desktop 与 hicolor 图标
```

从启动器打开装好的那份，再在窗口里打开「登录时启动」：XDG 自启项记的是启动时的路径，自启时只进托盘。
