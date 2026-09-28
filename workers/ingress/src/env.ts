import type { CollectorRpc } from "@shared/collector";
import type { StateCoreRpc } from "@shared/state-core";

/**
 * 上报入口的绑定与变量（wrangler.toml）。字符串变量同时进 `process.env`
 * （`nodejs_compat_populate_process_env`）：Emby 的跳转链接在 prepare 时从那里读
 * `EMBY_PUBLIC_URL`，拼进落库的条目。没有任何 secret。
 */
export interface Env {
  /** 状态核心（api Worker）的具名 entrypoint `StateCore`，契约见 shared/state-core.ts */
  CORE: StateCoreRpc;
  /**
   * 采集 Worker 的具名 entrypoint `Collector`（shared/collector.ts）：站点部署完成后让它
   * 立刻重拉部署列表。隔离验证脚本不起采集 Worker，不绑就跳过这一步。
   */
  COLLECTOR?: CollectorRpc;
  /** 上报器直传图片的那个桶。这里只 HEAD，回执告诉上报器哪些图还没到（Emby） */
  IMAGES: R2Bucket;
  /** 可滞后层（shared/lag.ts）：落地节点、限额、账本、时区、圆环读数与训练列表由这里直接写 */
  LAG?: KVNamespace;
  /** 共享凭据（shared/credentials.ts）：Mac 推来的 Apple Music user token 由这里写 */
  CREDENTIALS?: KVNamespace;
  /** 长期归档（上报的那几张表，见 ingest-archive.ts）；不绑就不归档 */
  HISTORY?: D1Database;

  /** Access 的 team 域名（`https://<team>.cloudflareaccess.com`），也是 JWT 的签发方。 */
  ACCESS_TEAM_DOMAIN?: string;
  /** `lyjwpage ingest` 这个 Access 应用的 AUD 标签。 */
  ACCESS_AUD?: string;
  /** 只在本地：team 域名为 DEV_ACCESS_ISSUER 时用这份 JWKS 验 JWT，见 access-auth.ts。 */
  ACCESS_DEV_JWKS?: string;
  /** service token 的 client id → 允许的权限串，见 wrangler.toml 的 [vars.ACCESS_CLIENTS]。 */
  ACCESS_CLIENTS?: Record<string, string[]>;
  /** Emby 条目「在 Emby 里打开」的链接前缀（浏览器侧地址），prepare 时拼进条目 */
  EMBY_PUBLIC_URL?: string;

  /** Sentry 的公开写入地址（沿用 api-worker 项目）；不配就不上报，见 sentry.ts。 */
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  /** Sentry SDK 从这里取 release（版本 ID）。 */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

/**
 * 分支预览。上报入口的 Service Binding 指向生产状态核心，预览版收下的上报会直接写进
 * 生产，所以 Workers Builds 里关掉它的预览构建；万一有预览版本跑起来，`[previews.vars]`
 * 的 PREVIEW_WORKER 让它拒收一切（上报 403、部署通知 404）。
 */
export function previewWorkerEnabled(): boolean {
  return process.env.PREVIEW_WORKER?.trim() === "true";
}
