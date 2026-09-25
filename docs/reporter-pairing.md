# 上报器配对登录

Mac Telemetry Hub 和 iPhone Telemetry Hub 不再手抄 Access service token：在 App 里点「登录」，
浏览器里用 Cloudflare Access（邮箱验证码或 GitHub）登录并确认，App 就拿到这个来源专用的
client id / client secret，存进钥匙串。重新登录就是换钥：旧 secret 当场作废。

流程和 OAuth 2.0 授权码 + PKCE（RFC 7636）同形，但只发一样东西：这台设备那把 service token。

## 参与方

| 角色 | 在哪 | 鉴权 |
| --- | --- | --- |
| 授权页 `GET/POST https://api.homepage.lyjw.llc/pair/authorize` | api Worker，`src/pairing.ts` | Access 应用「lyjwpage pairing」（`api.homepage.lyjw.llc/pair`，只放行站长邮箱）；Worker 再验这个应用签的 JWT 和邮箱白名单 `PAIRING_EMAILS`。放在 api 域名而不是 ingest 域名，是为了不和整站挂着的「lyjwpage ingest」叠在同一个主机上比路径优先级 |
| 兑换口 `POST https://api.homepage.lyjw.llc/api/pair/token` | 同上 | 公开；凭授权码 + PKCE verifier，验过才轮换 |
| 轮换 service token | Worker 调 Cloudflare API | Worker secret `CF_ACCESS_API_TOKEN`（只有 Access: Service Tokens Write） |

可配对的来源和各自的回调地址登记在 `wrangler.toml` 的 `[vars.PAIRING_SOURCES]`：

| 来源 | 回调（`redirect_uri`，逐字比较） |
| --- | --- |
| `mac` | `mactelemetryhub://pair` |
| `iphone` | `iphonetelemetryhub://pair` |

## 客户端步骤

1. 生成 `code_verifier`：32 字节随机数的 base64url（无填充）。`code_challenge = base64url(SHA-256(code_verifier))`。
   再生成随机 `state`。
2. 用 `ASWebAuthenticationSession`（`callbackURLScheme` 为上表 scheme）打开：

   ```text
   https://api.homepage.lyjw.llc/pair/authorize?source=<来源>&redirect_uri=<回调>&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
   ```

3. 用户在 Access 登录后看到确认页，点 Allow，Worker 把 `<回调>?code=<授权码>&state=<state>` 交回 App；
   点 Deny 回 `<回调>?error=access_denied&state=<state>`。这一步什么都不改：旧 secret 照常可用。
   App 必须核对 `state` 与第 1 步一致。
4. 5 分钟内兑换。Worker 验过码和 verifier 才轮换这个来源的 service token（旧 secret 当场作废），
   新 secret 只在这个响应里出现一次。请求要带自己的 `User-Agent`：Cloudflare 的浏览器完整性检查
   会拦某些默认 UA（Python urllib 实测被 403 / 1010）。

   ```http
   POST https://api.homepage.lyjw.llc/api/pair/token
   Content-Type: application/json

   {"code": "<授权码>", "codeVerifier": "<code_verifier>"}
   ```

   成功 `200 {"ok":true,"data":{"source":"mac","clientId":"….access","clientSecret":"cfast_…","ingestUrl":"https://ingest.homepage.lyjw.llc/api/ingest/mac"}}`；
   失败 `400 {"ok":false,"error":"…"}`（码过期、verifier 不对、码被改过）。
5. 把 `clientId`、`clientSecret`、`ingestUrl` 存进设置（secret 进钥匙串），之后按
   `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头上报。

## 授权码

授权码是 Worker 用 `PAIRING_KEY`（32 字节随机，Worker secret）做 AES-256-GCM 加密的一小段 JSON：
来源、`code_challenge`、到期时刻，不含任何凭据。Worker 不存状态；码被截走也没用，兑换要 verifier，
verifier 只在发起配对的那个 App 里。确认页的表单另带一个用 `PAIRING_KEY` 签的防伪字段，
别的网站替你提交不了 Allow。

## 取舍

- 确认页不能省：没有它，别人发来一条带自己 challenge 的授权链接，你点开登录就把凭据给了对方。
  确认页写明是哪个来源、哪台设备，不是你刚发起的就点 Deny。
- 轮换放在兑换这一步、而且立刻作废旧 secret：浏览器半路关掉、回调没回来都不会让设备掉线；
  兑换成功才换钥，旧设备上的配置当场失效。
- 只在生产可用：本地没有 Access，`PAIRING_KEY` 和 `CF_ACCESS_API_TOKEN` 也只配在线上 Worker。
  逻辑由 `src/pairing.test.ts` 覆盖。
- Worker 多持有一个能轮换 service token 的 API token。它碰不到 Access 应用和策略，
  最坏情况是把某个上报器的 secret 换掉，让它掉线；凭它新建的 token 既不在 Access 策略里，
  也不在 `ACCESS_CLIENTS` 表里，进不了门。
