# @lyjwpage/musickit-token

用 Apple 的 `.p8` 私钥现签 MusicKit developer token 的 Cloudflare Worker。
站点的「一起听」要它：访客用自己的 Apple Music 订阅授权之前，先得有一份 developer
token 才能把 MusicKit JS 配起来。

## 为什么单独开一个 Worker

私钥不进站点的运行时。站点部署在 Vercel，函数实例、构建日志、预览环境都能碰到那份
环境变量；而这里只做一件事、只有一个出口、只吐一个有期限的令牌（默认 7 天）。

也不能把令牌交给「最近在听」那条 `/api/ingest/apple-music` 的 GET —— 那条给的是
Mac 上报器现签的、带 music user token 的那份**私人凭据**，拿到就能读我的收听记录，
所以它锁在 `TELEMETRY_INGEST_SECRET` 后面。这里要发的是给**任何一个访客**的公开
令牌，访客再拿它去换自己的用户令牌。两者敏感度差一个量级，不共用一条路径。

## 域名限制是怎么落地的

`ALLOWED_ORIGINS` 一份名单，两道限制：

1. **谁能来要令牌** —— 比请求的 `Origin` 头。配了名单之后不带这个头一律拒绝。
   这道只是让「拿一份」不那么随手：Origin 头是请求方自己写的，非浏览器伪造得了。
2. **令牌只在这些域上有效** —— 签进 JWT 的 `origin` 声明，由 Apple 校验。
   令牌被复制到别的站点上就是废的。真正兜底的是这道。

Apple 不解析通配符，所以 `https://*.vercel.app` 这类只参与第一道；通过之后，签进
声明的是**这次请求那个具体来源**。预览域名和 localhost 因此都能用，而声明里出现的
始终是写死的完整来源，没有通配符。

**来路不是名单里写死的那几个时（预览域名、localhost），声明里就只有它自己。**
不这么分的话，第一道那点松就把第二道也带松了：localhost 是无条件放行的，公网上
任何人带一句 `Origin: http://localhost:3000` 就能要走一份声明含 `lyjw.me` 的令牌，
在自己的页面上直接可用，有效期七天。

签出来的 JWT 长这样 —— 来路是 `https://lyjw.me`（名单里写死的）时：

```json
{ "alg": "ES256", "kid": "FGHIJ67890" }
{ "iss": "ABCDE12345", "iat": 1755734400, "exp": 1756339200,
  "origin": ["https://lyjw.me", "https://lyjw131.com", "https://dev.lyjw.me"] }
```

来路是 `https://lyjwpage-abc123.vercel.app`（通配匹配上的）时：

```json
{ "iss": "ABCDE12345", "iat": 1755734400, "exp": 1756339200,
  "origin": ["https://lyjwpage-abc123.vercel.app"] }
```

## 部署信息

- **自定义域名**：在 `wrangler.toml` 的 `routes` 里配
- **默认域名**：`workers_dev = true` 时 Cloudflare 会给一个 `<名字>.<账号>.workers.dev`
- **推 main 时 CI 自动部署**（见 .github/workflows/deploy-workers.yml），手动
  `wrangler deploy` 也行

部署完把地址填进站点的 `NEXT_PUBLIC_MUSICKIT_TOKEN_URL`。不填则「一起听」按钮不出现，
卡片其余部分照常。

### 需要的三样东西

在 [Apple Developer](https://developer.apple.com/account/resources/authkeys/list) 建一个
勾了 **MusicKit** 的密钥，会拿到：

| 变量 | 哪来的 | 放哪 |
| --- | --- | --- |
| `APPLE_MUSIC_TEAM_ID` | 账号首页右上角那串 10 位 | `[vars]`，不是秘密 |
| `APPLE_MUSIC_KEY_ID` | 建密钥时给的 10 位 Key ID | `[vars]`，不是秘密 |
| `APPLE_MUSIC_PRIVATE_KEY` | 下载的 `AuthKey_XXXXXXXXXX.p8` 全文 | **secret** |

`.p8` 只能下载一次，下完存好。

```bash
# 私钥走 secret，别写进 wrangler.toml
wrangler secret put APPLE_MUSIC_PRIVATE_KEY < AuthKey_FGHIJ67890.p8
```

带 PEM 头尾的整份、字面量 `\n` 的一行、只有中间那段 base64，三种写法都吃得下。

## 接口说明

- **请求方式**：`GET /token`
- **入参**：无。域名限制看 `Origin` 头
- **缓存**：同一份 origin 声明的令牌在 isolate 里复用，**过了半衰期**才重签。
  响应一律 `Cache-Control: no-store`

### 请求示例

```bash
curl -H "Origin: https://lyjw.me" "https://musickit.example.com/token"
```

### 返回格式

```json
{
  "token": "eyJhbGciOiJFUzI1NiIsImtpZCI6...",
  "issuedAt": 1755734400,
  "expiresAt": 1756339200
}
```

两个时刻都是 Unix **秒**，和 JWT 的 `iat` / `exp` 一一对应。

**两个都给，是因为续期看的是半衰期**：过了「签发 → 到期」的中点就换一份新的。
只给到期时刻的话，站点那侧只能拿「我什么时候收到的」当起点，而收到的可能已经是
这里缓存着的、用掉一半的那份。

取相对中点而不是写死提前量：改了 `TOKEN_TTL_SECONDS` 不用跟着调第二个数，而写死
的那个在两个方向上都可能错 —— 对七天的令牌，提前五分钟等于几乎不续；对一小时的
令牌，提前一天等于每次都续。站点那侧和 Mac 上报器续自己那份 developer token 用的
都是这条规则。

出错时是 `{ "error": "没有配置 APPLE_MUSIC_TEAM_ID" }` 加对应状态码：
403 来源不对、404 路径不对、405 方法不对、500 配置错或私钥坏。

## 开发与部署

```bash
# 本地调试。不配 ALLOWED_ORIGINS 就不限制来源，签出来的令牌也不带 origin 声明
pnpm --filter @lyjwpage/musickit-token dev

# 类型检查
pnpm --filter @lyjwpage/musickit-token typecheck

# 部署上线
pnpm --filter @lyjwpage/musickit-token run deploy
```
