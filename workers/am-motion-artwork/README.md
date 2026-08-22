# @lyjwpage/am-motion-artwork

Cloudflare Worker 代理服务：用于解析 Apple Music 专辑与单曲的 1:1 正方形动态封面（`motionDetailSquare`）视频及背景主题色调板。

## 部署信息
- **自定义域名**：在 `wrangler.toml` 的 `routes` 里配
- **默认域名**：`workers_dev = true` 时 Cloudflare 会给一个 `<名字>.<账号>.workers.dev`
- **推 main 时 CI 自动部署**（见 .github/workflows/deploy-workers.yml），手动 `wrangler deploy` 也行

部署完把地址填进站点的 `NEXT_PUBLIC_MOTION_ARTWORK_URL`。不填则动态封面整体停用，
静态封面照常显示。

## 环境变量

- `ALLOWED_ORIGINS`：来源白名单，逗号分隔。支持 `https://*.vercel.app` 这样的后缀
  通配 —— 预览域名每次部署都换一个。**留空 = 不限来源**（只为 `wrangler dev` 留的，
  公网那份必须配；localhost 始终放行）。配上之后**不带 `Origin` 头的请求一律拒绝**，
  用 curl 验证时要自己加 `-H "Origin: https://…"`。

  名单和 `live-push` / `online-counter` / `musickit-token` 那三个 worker 是同一份，
  加域名时四个都要改、都要重新部署。

  这个 worker 从前是五个里唯一完全敞开的（`ACAO: *`，没有任何来源校验）：谁都能拿
  `?url=<任意 Apple Music 链接>` 当免费的 Apple Music 目录代理用，烧的是本账号的
  Workers 请求配额和 CPU 时间；边缘缓存只在同一个 URL 重复时挡得住，换个 `?url=`
  就绕开了。`parseAppleMusicUrl` 把主机名限死在 `music.apple.com`，所以不是 SSRF，
  但作为一个挂在自有域名上的开放中继仍然该收。

## 接口说明
- **请求方式**：`GET`
- **入参**：`url`（需要提取动态封面的 Apple Music 链接）
- **缓存策略**：使用 Cloudflare Cache API 与边缘 CDN 缓存。**有**动态封面缓存 24 小时，
  **确认没有**缓存 1 小时，**上游出错**（amp-api 5xx、token 扒不到、超时）一律
  `no-store`、不写边缘缓存 —— 否则 token 早换好了、同一个 URL 一小时内还是拿不到
  正确答案。
- **CORS**：`Access-Control-Allow-Origin` 回显具体来源并带 `Vary: Origin`。
  存进边缘缓存的那一份**不带** CORS 头，命中之后按当次请求现补 —— 存进去的话
  `caches.default` 会把某一个来源的响应原样发给另一个来源。

### 请求示例
```bash
curl -H "Origin: https://lyjw.me" \
  "https://am-motion-artwork.example.com/?url=https%3A%2F%2Fmusic.apple.com%2Fus%2Falbum%2Fpositions%2F1538081237"
```

### 返回格式

所有 JSON 响应都是同一个形状，出错时多一个 `error`：

```json
{
  "hasMotion": true,
  "videoUrl": "https://video-ssl.itunes.apple.com/...",
  "colors": ["18171f", "fcfcfc", "aba7ae", "95929a", "6c6771"]
}
```

状态码：400 入参不对、403 来源不在名单内、405 方法不对、500 上游或运行时出错
（原文只进 Worker 日志，不外带）。

## 开发与部署
```bash
# 本地调试
pnpm --filter @lyjwpage/am-motion-artwork dev

# 类型检查
pnpm --filter @lyjwpage/am-motion-artwork typecheck

# 部署上线
pnpm --filter @lyjwpage/am-motion-artwork run deploy
```
