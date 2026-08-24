import { config, dryRun } from "./config.js";
import { info } from "./log.js";
import type { PlayedGamesReport, PresenceReport } from "./psn.js";

/**
 * 和站点之间那一个方向。
 *
 * **站点侧的 `/api/ingest/playstation` 目前还不存在** —— 下面这个信封是给它写的
 * 契约草案（README 里有同一份，带字段说明）。所以这份上报器的主形态是 dry-run：
 * 没配站点地址就把本该 POST 的信封打到 stdout，形状和真推的一模一样。
 */

/**
 * 推给站点的一份 PlayStation 状态。
 *
 * `version` 是信封版本，将来改形状时站点据此区分；两个部分**各自可省**，
 * 因为两路轮询节奏不同（30 秒 / 5 分钟），各推各的。这一点和 emby 那份的
 * resume / playing / images 是同一个模式：缺席表示「这次不谈这一项」。
 *
 * 每一部分自带 `observedAt`（epoch 毫秒）—— 不放在信封顶层，因为两部分是在
 * 不同时刻观测到的，共用一个时间戳就是把其中一个说谎地说新了。
 */
export type PlaystationEnvelope = {
  version: 1;
  /** 缺席 = 这次不谈此刻状态；给了对象就是那一刻的完整快照 */
  presence?: PresenceReport;
  /** 缺席 = 这次不谈列表 */
  playedGames?: PlayedGamesReport;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return config.site.secret ? { Authorization: `Bearer ${config.site.secret}` } : {};
}

/**
 * 和另外两份上报器的同名函数是同一段代码
 * （见 reporters/apple-music-reporter/src/site.ts、reporters/emby-reporter/src/site.ts），
 * 改一处记得同步另两处。
 *
 * 这不是随手的复制粘贴：它规定了「站点回了 `ok !== true` 就算失败」这条约定，
 * 是**协议**的一部分。几份哪天分了岔，症状会是其中一个上报器把站点的软失败当成
 * 了成功 —— 而没有任何测试或类型会拦住。
 */
async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

/** 站点回执。站点还没写，所以字段都当作可能没有 */
export type Receipt = { changed: boolean };

/**
 * 交一份信封。
 *
 * 配了站点地址就真 POST，没配就打到 stdout —— 后者是这个原型的主形态，
 * 打出来的就是**一字不差**将来会被 POST 的那份 body。
 */
export async function deliver(envelope: PlaystationEnvelope): Promise<Receipt> {
  if (dryRun) {
    // 缩进两格打出来是给人看的；真推时 body 是紧凑的 JSON.stringify(envelope)
    console.log(JSON.stringify(envelope, null, 2));
    return { changed: true };
  }

  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });

  const data = await readEnvelope<{ changed?: boolean }>(response);
  return { changed: data?.changed === true };
}

/** 启动时把「往哪儿推」说一遍，省得对着一片安静的 stdout 猜它是不是在 dry-run */
export function announceTarget() {
  if (dryRun) {
    info(
      "没配 SITE_URL / SITE_INGEST_URL，进 dry-run：信封只打到 stdout。" +
        "（站点侧的 /api/ingest/playstation 目前也还不存在）",
    );
    return;
  }
  info(`推送目标 ${config.site.ingestUrl}`);
  if (!config.site.secret) {
    info("没配 TELEMETRY_INGEST_SECRET —— 只有站点也没配时才可以这样");
  }
}
