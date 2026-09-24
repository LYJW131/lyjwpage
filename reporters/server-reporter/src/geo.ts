/**
 * 公网 IP 的 Location / ISP / ASN。先问 ip.sb，失败退 ip-api；结果按 IP 缓存 6 小时，
 * 地址没变就不打上游。查的是网卡上的地址，不是「访问某个 what-is-my-ip 看到的出口」。
 */
import { config } from "./config.js";
import { failure, recovered } from "./log.js";

const GEO_TTL_MS = 6 * 3_600_000;
const GEO_TIMEOUT_MS = 5_000;
const USER_AGENT = "lyjwpage-server-reporter/2.0";
const AS_LINE = /^AS(\d+)\s*(.*)$/i;

export type Geo = {
  country: string | null;
  city: string | null;
  isp: string | null;
  asn: number | null;
  asnOrg: string | null;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`geo 接口返回 ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("geo 接口返回的不是对象");
  return body as Record<string, unknown>;
}

/** 「AS142616 Misaka Network, Inc.」→ [142616, "Misaka Network, Inc."]。纯函数 */
export function parseAs(raw: string): [number | null, string | null] {
  const match = AS_LINE.exec(raw.trim());
  if (!match) return [null, null];
  return [Number(match[1]), match[2]?.trim() || null];
}

async function lookupIpSb(ip: string): Promise<Geo> {
  const row = await getJson(`https://api.ip.sb/geoip/${ip}`);
  const asnRaw = row.asn;
  const asn = typeof asnRaw === "number" ? asnRaw : typeof asnRaw === "string" && /^\d+$/.test(asnRaw) ? Number(asnRaw) : 0;
  const org = textOrNull(row.asn_organization ?? row.organization);
  return {
    country: textOrNull(row.country),
    city: textOrNull(row.city),
    isp: textOrNull(row.isp) ?? org,
    asn: asn > 0 ? asn : null,
    asnOrg: org,
  };
}

async function lookupIpApi(ip: string): Promise<Geo> {
  const row = await getJson(`http://ip-api.com/json/${ip}?fields=status,message,country,city,isp,org,as`);
  if (row.status !== "success") throw new Error(textOrNull(row.message) ?? "ip-api 失败");
  const [asn, asOrg] = parseAs(String(row.as ?? ""));
  const org = asOrg ?? textOrNull(row.org);
  return {
    country: textOrNull(row.country),
    city: textOrNull(row.city),
    isp: textOrNull(row.isp) ?? org,
    asn,
    asnOrg: org,
  };
}

let cached: { ip: string; at: number; geo: Geo } | null = null;

export async function geoFor(ip: string): Promise<Geo> {
  const now = Date.now();
  if (cached?.ip === ip && now - cached.at < GEO_TTL_MS) return cached.geo;
  let found: Geo;
  try {
    found = await lookupIpSb(ip);
    recovered("geo");
  } catch (error) {
    failure("geo", error);
    try {
      found = await lookupIpApi(ip);
      recovered("geo");
    } catch (fallback) {
      failure("geo", fallback);
      // 两家都挂：同一个 IP 就沿用上次那份，换了 IP 才只剩城市
      if (cached?.ip === ip) return cached.geo;
      found = { country: null, city: config.location || null, isp: null, asn: null, asnOrg: null };
    }
  }
  cached = { ip, at: now, geo: found };
  return found;
}
