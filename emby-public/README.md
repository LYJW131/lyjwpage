# emby-public — Emby 只读展示站

`https://emby.homepage.lyjw.llc`。个人主页「最近在看」卡片的跳转目标：访客打开即以
`guest` 身份浏览元数据（海报、简介、剧集列表），不能播放、不能下载、不能改任何状态。
要播放请去 `emby.lyjw131.com`（那边有 authentik）。

## 结构

```
访客 ──HTTPS──▶ Cloudflare 边缘 ──Tunnel──▶ cloudflared ──▶ nginx ──▶ Emby (EMBY_SERVER)
```

两个容器，独立 compose 项目，不经 Traefik / frp。TLS 在 Cloudflare 终结，nginx 只听 80、
不映射端口，只有同一 compose 网络里的 cloudflared 能打到它。

## 安全模型 —— 改任何东西之前先读

**访客浏览器里没有真 token。** 这是整站唯一真正的闸，理由是两条实测结论：

1. Emby 的 access token 不分域名。展示站签出来的 token 拿去 emby.lyjw131.com 一样能用。
2. 用户策略里的 `EnableMediaPlayback=false` **拦不住** `/Videos/{id}/stream`、`/Items/{id}/File`
   这类直出字节的接口（直连 Emby 也一样 200 开始吐文件；经 emby.lyjw131.com 则被
   clouddrive307 307 到网盘直链）。策略只让网页端藏起播放按钮，服务端并不拒绝。

所以：

- `js/custom/guest.js` 往 localStorage 写的凭据里 AccessToken 是假的 `"public"`。
- nginx 对每个转发到 Emby 的请求整体覆盖 `X-Emby-Authorization` / `X-Emby-Token`，并把
  查询串里客户端自带的 `api_key` / `X-Emby-Token` 摘掉、换成 `.env` 里的 `EMBY_GUEST_TOKEN`
  （见 `emby-proxy-headers.inc.template` 和 `nginx.conf.template` 顶部那几个 map）。
- nginx 再 403 掉播放 / 下载路径和所有非 GET 请求（POST 只放行 `/Sessions/Capabilities*`），
  包括 `/Sessions/Logout` —— 登出会吊销共享 token，一个访客点一下全站就挂。
  这是第二道，不是闸：就算漏放一条，访客手里也没有能在别处用的 token。

Emby 侧的 `guest` 用户策略也照样收紧了（禁播放 / 下载 / 转码 / 同步 / 分享 / 改偏好，隐藏），
库范围复制自 `example`（TV动画、剧场版动漫、音乐、播放列表）。那是「网页端别显示播放按钮」
的作用，不要把它当成防线。

**别做的事**：把真 token 写进任何前端文件；把 guest 的密码或 token 交给 user-map 之外的
东西；在 emby-proxy 那边给 guest 开任何例外。

## 部署

```bash
# 在 Mac 上，仓库根目录
COPYFILE_DISABLE=1 tar czf - -C <本目录的父目录> emby-public | ssh dsm 'tar xzf - -C /volume3/docker'
ssh dsm 'cat > /volume3/docker/emby-public/.env && chmod 600 /volume3/docker/emby-public/.env' < .env
ssh dsm 'cd /volume3/docker/emby-public && /usr/local/bin/docker compose up -d'
```

`.env` 四个值见 `.env.example`。改了 nginx 模板要重建（模板在启动时渲染一次）。
**两个容器一起重建**，别只重建 nginx：cloudflared 缓存着 nginx 的容器 IP，nginx 换了 IP
它还往旧地址打，公网上就是一阵 530，直到它自己重新解析：

```bash
ssh dsm 'cd /volume3/docker/emby-public && /usr/local/bin/docker compose up -d --force-recreate'
```

## 重新签 token

guest 的 token 在 Emby 里长期有效，但以下情况会失效：在 Emby 后台删了「Public Guest」这台设备、
改了 guest 的密码、或者有人在别处以 guest 登出。失效的表现是整站 401。重签：

```bash
curl -s -X POST "http://192.168.3.42:8096/emby/Users/AuthenticateByName" \
  -H 'Content-Type: application/json' \
  -H 'X-Emby-Authorization: MediaBrowser Client="Emby Web", Device="Public Guest", DeviceId="emby-public-guest", Version="4.9.5.0"' \
  -d '{"Username":"guest","Pw":"<guest 密码>"}'
```

guest 的密码在 `/volume3/docker/emby-proxy/users/users.yaml`（它是通过 user-map 建的）。
把返回的 `AccessToken` 填进 `.env`，重建 nginx。Client 名字**不要**带 `(oauth2)`：user-map 会把
带这个后缀、闲置超过 24 小时的设备清掉，这个 token 就跟着没了。

## 只读外观

`js/custom/guest.css` 把所有操作控件藏掉（条目页的播放 / 已看 / 收藏 / 更多，卡片悬浮的
播放 / 菜单 / 多选，头部的投屏 / 用户 / 设置，库页的播放 / 随机 / 视图设置，列表行按钮），
`guest.js` 里的 `killActionSheets` 把长按 / 右键弹出的操作面板一进 DOM 就拆掉。排序和过滤留着。

- class 名对的是 Emby Web 4.9.5。**Emby 升级后重新对一遍**：在页面控制台跑
  `[...document.querySelectorAll('button,[data-action]')].map(e => e.className + ' ' + e.dataset.action)`
  看有没有新冒出来的操作按钮。
- `guest.css` / `guest.js` 走 Cloudflare 边缘缓存（按扩展名，约 4 小时）。**改了文件就把
  `nginx.conf.template` 里 `?v=` 的数字加一**，不然访客拿到的是旧的。

## 少加载的 JS

Emby Web 启动时把 app.js 里列的插件全部 require 一遍。投屏 / 远程控制 / 屏保 / 电子书 /
图片 / PDF / YouTube / 外部播放器这 11 个（名单在 `nginx.conf.template` 的两条正则里）在只读站
用不上，nginx 对它们直接回 `js/custom/plugin-stub.js`：形状和真插件一样，pluginmanager 注册完
就没人再碰。主要省的是 chromecast 拉的 gstatic `cast_sender.js`（两个外站请求）和
sessionplayer / chromecastplayer 各二三十 KB；首屏请求数只从 134 降到 133，量不大。

**htmlvideoplayer / htmlaudioplayer 不能换**：条目页显示媒体信息时调它们的 `getDeviceProfile`，
换了整页「处理请求时出错」（踩过）。playbackmanager / nowplayingbar / osdcontroller 是
approuter 的硬依赖，也动不了。

这些 URL 带 `?v=<Emby 版本>`，Cloudflare 边缘按 URL 缓存了真文件：**改名单或 Emby 升级后
要在 lyjw.dev 的缓存配置里按主机名 `emby.lyjw.dev` 清一次**，不然边缘继续发旧的。

## 已知的坑

- **user-map 会试图按 example 重建用户**：它登录失败时会再调一次 `/Users/New`，用户已存在时
  Emby 拒绝、它报错收场，并不会删掉重建（日志里看过）。但如果哪天 guest 真被删了再由它建回来，
  策略就是 example 的原样（可播放）。这不影响本站的安全闸（真 token 不在浏览器里），但那时
  token 也换了，本站会 401，按上面重签并重新收紧策略。
- emby.lyjw131.com 那边 `/Items/{id}/File` 和经 clouddrive307 的 stream / Download 对**任何**
  有效 token 都直出。只要 guest 的真 token 不出 NAS 就与本站无关，但那是那边自己的暴露面。
- 所有访客共用一个 Emby 设备（`emby-public-guest`），Emby 后台的「设备」里只会看到一台。
