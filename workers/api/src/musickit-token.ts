// 走别名不走相对路径：node --test 认不出没有扩展名的相对导入，register-alias 只接管别名
import { getAllowedOrigins, type OriginEnv } from "@api/origins";

/**
 * 用 Apple 的 `.p8` 私钥现签 MusicKit developer token。
 *
 * 站点的「一起听」要它：访客用自己的 Apple Music 订阅授权之前，先得有一份
 * developer token 才能把 MusicKit JS 配起来。私钥不进站点的运行时 —— 站点部署
 * 在 Vercel，函数实例、构建日志、预览环境都能碰到那份环境变量；放在 Worker 上
 * 只有一个出口、只吐一份有期限的令牌。
 *
 * 也不能拿 Redis 里那份 Mac 上报的凭据来发 —— 那是带 music user token 的
 * **私人凭据**，拿到就能读收听记录，只在 apple-music-recent.ts 里服务端用。
 * 这里发的是给**任何一个访客**的公开令牌，访客再拿它去换自己的用户令牌。
 * 两者敏感度差一个量级，不共用一条路径。
 *
 * 从前是单独的 musickit-token Worker，09-07 并进 ingest：路径 /musickit/token，
 * 来源白名单和 CORS 与两条 WebSocket 共用同一份 ALLOWED_ORIGINS。
 */

export interface MusicKitTokenEnv extends OriginEnv {
  /** .p8 私钥全文。带不带 PEM 头尾、换行是真的还是 `\n` 都能吃，见 importSigningKey */
  APPLE_MUSIC_PRIVATE_KEY?: string;
  /** 私钥的 Key ID，10 位。Apple Developer 后台建 MusicKit 密钥时给的 */
  APPLE_MUSIC_KEY_ID?: string;
  /** Team ID，10 位。签发者（JWT 的 iss） */
  APPLE_MUSIC_TEAM_ID?: string;
  /** 令牌有效期（秒）。不填按 DEFAULT_TTL_SECONDS */
  MUSICKIT_TOKEN_TTL_SECONDS?: string;
}

/**
 * 七天。
 *
 * Apple 允许最长半年，但这个令牌是发给任何一个打开页面的访客的 —— 它一旦被复制
 * 走，域名限制之外就只剩有效期这一道闸，所以不取上限。
 */
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Apple 的硬上限：15777000 秒 ≈ 半年。签超了对方直接拒 */
export const MAX_TTL_SECONDS = 15777000;

export type IssuedToken = { token: string; issuedAt: number; expiresAt: number };

/**
 * 措辞可控、可以原文回给客户端的配置错误。
 *
 * 只有部署的人能修这类问题，所以提示要外带；但外带的文案只从 `hint` 取 ——
 * 它是我们自己写死的字符串，不是异常对象身上的 message / stack，任意运行时
 * 异常（importKey 的 DER 解析、平台错误）都不会顺着这条路漏出去。
 */
export class ConfigError extends Error {
  readonly hint: string;
  constructor(hint: string) {
    super(hint);
    this.hint = hint;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * .p8 的内容解成 PKCS#8 的字节。
 *
 * 三种写法都要吃下来，因为它们都是人真的会填进去的：贴进 Cloudflare 后台的密钥
 * 框里是带真换行的整份 PEM；从 CI 的变量里传过来常常变成字面量 `\n`；有人则只
 * 贴中间那段 base64。头尾和所有空白一起剥掉，剩下的就是 base64 本体。
 */
function decodePkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/**
 * 导入的私钥留在模块作用域里复用。
 *
 * 同一个 isolate 会连着服务很多请求，而 importKey 每次都要重新解析一遍 DER。
 * `extractable: false` —— 导进来之后连我们自己也读不回明文，少一条泄漏路径。
 * 缓存记着它对应哪份 PEM：线上一个部署只有一把钥匙，但测试里会换钥匙对，
 * `wrangler dev` 热更 secret 时也不该继续拿旧钥匙签。
 */
let signingKey: { pem: string; key: CryptoKey } | null = null;

async function importSigningKey(env: MusicKitTokenEnv): Promise<CryptoKey> {
  const raw = env.APPLE_MUSIC_PRIVATE_KEY?.trim();
  if (!raw) throw new ConfigError("没有配置 APPLE_MUSIC_PRIVATE_KEY");
  if (signingKey?.pem === raw) return signingKey.key;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePkcs8(raw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  signingKey = { pem: raw, key };
  return key;
}

/**
 * 签进 JWT 的 origin 声明 —— 这个功能的域名限制真正落地的地方。
 *
 * Apple 只认写死的完整来源，通配符它不解析。所以名单里的通配项（`https://*.
 * vercel.app`）不能原样塞进去，得换成**这次来要令牌的那个来源**：它刚在
 * isAllowedOrigin 里比对通过，是一个已经确认合法的具体值。localhost 同理 ——
 * 它始终放行但不会出现在名单里，不补进去的话本地就调不动。
 *
 * **来路不是名单里写死的那几个时，只签它自己一个，不把生产域名一起捎上。**
 * 否则 localhost 无条件放行（isAllowedOriginValue），公网上任何人带一句
 * `Origin: http://localhost:3000` 就能要走一份声明里含 lyjw.me / lyjw131.com
 * 的令牌，在自己的页面上直接可用 —— 等于把「真正兜底的那道」也一并交了出去。
 * 通配匹配到的预览域名同理：`*.vercel.app` 底下并不都是我们的部署。
 *
 * 名单里写死的那几个仍然一起签：它们都是自家域名，共用一份令牌能共用一条
 * tokenCache 条目，省掉每个域各签一次。
 *
 * 返回空数组表示「不加这条声明」：一条都没配时（`wrangler dev`）签一个无限制的
 * 令牌，比签一个 origin 为空、Apple 一律拒收的令牌有用。
 */
export function signedOrigins(origin: string | null, allowed: string[]): string[] {
  if (allowed.length === 0) return [];

  const literal = allowed.filter((pattern) => !pattern.includes("*"));
  // 名单非空时 isAllowedOrigin 已经把不带 Origin 的请求拦下了，这条是防御
  if (!origin) return literal;
  return literal.includes(origin) ? literal : [origin];
}

export function resolveTtlSeconds(env: MusicKitTokenEnv): number {
  const raw = Number(env.MUSICKIT_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(raw), MAX_TTL_SECONDS);
}

/**
 * 过了「签发时刻 → 到期时刻」的中点就该换一份新的。
 *
 * 取相对中点而不是写死提前量：改了 MUSICKIT_TOKEN_TTL_SECONDS 不用跟着调第二个数，
 * 而写死的那个在两个方向上都可能错 —— 对七天的令牌，提前五分钟等于几乎不续；
 * 对一小时的令牌，提前一天等于每次都续。
 *
 * 站点那侧判是不是该重新要一份用的是同一条规则（见 src/lib/musickit.ts 的
 * pastHalfLife），Mac 上报器续它自己那份 developer token 也是。改一处记得对齐。
 */
export function pastHalfLife(token: IssuedToken, now: number): boolean {
  return now >= token.issuedAt + (token.expiresAt - token.issuedAt) / 2;
}

/**
 * 按 origin 声明分开缓存。
 *
 * 声明不同的令牌不能互相顶替 —— 预览域名各签各的。键就用那串声明本身，省掉再
 * 造一个 ID。签名本身不贵，这里省的是每个请求都做一次 ECDSA 的那点延迟。
 *
 * 键里不带有效期：决定令牌内容的另外几样（TTL、Team ID、Key ID、私钥）都是部署
 * 期固定的，改了就是一次重新部署、isolate 连同这张表一起换掉。只有 `wrangler
 * dev` 热更 vars 时旧值会多活一会儿，不影响线上。
 */
const tokenCache = new Map<string, IssuedToken>();
/**
 * 缓存条目的上限。预览域名一个部署换一个，isolate 活得够久的话这张表只增不减；
 * 满了就淘汰最早插入的那条（Map 按插入序遍历）。
 */
const TOKEN_CACHE_LIMIT = 32;

export async function issueMusicKitToken(
  origin: string | null,
  env: MusicKitTokenEnv,
  { now = Math.floor(Date.now() / 1000), cache = tokenCache }: { now?: number; cache?: Map<string, IssuedToken> } = {},
): Promise<IssuedToken> {
  const teamId = env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = env.APPLE_MUSIC_KEY_ID?.trim();
  if (!teamId) throw new ConfigError("没有配置 APPLE_MUSIC_TEAM_ID");
  if (!keyId) throw new ConfigError("没有配置 APPLE_MUSIC_KEY_ID");

  const origins = signedOrigins(origin, getAllowedOrigins(env));
  const cacheKey = origins.join(",");

  const cached = cache.get(cacheKey);
  if (cached && !pastHalfLife(cached, now)) return cached;

  const issued = await signDeveloperToken({ teamId, keyId, origins }, env, now);
  if (cache.size >= TOKEN_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, issued);
  return issued;
}

/** Worker 自用那份只有一个，缓存就是一个格子，不进上面按声明分开的那张表 */
const apiTokenCache: { current: IssuedToken | null } = { current: null };

/**
 * Worker 自己调 Apple Music API（找曲目链接、拉最近播放）用的 developer token。
 *
 * 和给访客的那份分开签：不带 origin 声明 —— 那条是 MusicKit JS 在浏览器里校验
 * 用的，服务端直接打 api.music.apple.com 不需要，也不该把访客域名签进自己的令牌。
 *
 * 从前这份 token 由 Mac 上报器用 MusicKit 现签后推上来。代价是它会过期，而上报器
 * 只在 token 变化时才发，MusicKit 的缓存又不自己轮换 —— 实测过期两天后 Worker
 * 还拿着旧的挨 401。私钥既然已经在这里（给「一起听」签发），就不该再绕那台 Mac。
 */
export async function issueApiDeveloperToken(
  env: MusicKitTokenEnv,
  { now = Math.floor(Date.now() / 1000), cache = apiTokenCache }: { now?: number; cache?: { current: IssuedToken | null } } = {},
): Promise<IssuedToken> {
  const teamId = env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = env.APPLE_MUSIC_KEY_ID?.trim();
  if (!teamId) throw new ConfigError("没有配置 APPLE_MUSIC_TEAM_ID");
  if (!keyId) throw new ConfigError("没有配置 APPLE_MUSIC_KEY_ID");

  if (cache.current && !pastHalfLife(cache.current, now)) return cache.current;
  const issued = await signDeveloperToken({ teamId, keyId, origins: [] }, env, now);
  cache.current = issued;
  return issued;
}

/** 两种 developer token 共用的签名核心：声明由调用方定，缓存也由调用方管 */
async function signDeveloperToken(
  claims: { teamId: string; keyId: string; origins: string[] },
  env: MusicKitTokenEnv,
  now: number,
): Promise<IssuedToken> {
  const expiresAt = now + resolveTtlSeconds(env);
  const header = { alg: "ES256", kid: claims.keyId };
  const payload = {
    iss: claims.teamId,
    iat: now,
    exp: expiresAt,
    // 空数组会被 Apple 当成「一个来源都不许」，没配名单时干脆不带这一条
    ...(claims.origins.length > 0 ? { origin: claims.origins } : {}),
  };

  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importSigningKey(env),
    new TextEncoder().encode(signingInput),
  );

  /*
   * WebCrypto 的 ECDSA 签名出来就是 r‖s 的定长拼接（P-256 是 64 字节），正好是
   * JWS 要的那种。别在这里加 DER 封装 —— OpenSSL 那套输出的是 DER，两者不通用，
   * 混了 Apple 会以「签名不对」拒掉，而错误信息里看不出是编码问题。
   */
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return { token, issuedAt: now, expiresAt };
}
