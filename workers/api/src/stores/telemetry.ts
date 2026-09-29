import { recordCodingObservation } from "@api/stores/coding-pulse";
import { isCodingApp } from "@shared/coding-apps";
import { listeningObservation } from "@shared/pulse-listening";
import { chargerPushPayload } from "@/lib/anker";
import { readChargerState } from "@/lib/charger-store";
import { askSettlingAt, settlingDecision } from "@/lib/charging-settling";
import {
  getHomePodSnapshot,
  playableHomePod,
  type StoredHomePod,
} from "@/lib/homepod-store";
import { chargerActive, liveTrack, powerBankActive } from "@/lib/home-layout";
import { CHARGER_TAG, DESKTOP_TAG, NOW_LISTENING_TAG, POWERBANK_TAG } from "@/lib/live-events";
import type { PlayingQueueTrack } from "@/lib/playing-queue";
import { powerBankPushPayload } from "@/lib/powerbank";
import { readPowerBankState } from "@/lib/powerbank-store";
import { nextLiveness, readLiveness, type Liveness } from "@/lib/reporter-liveness";
import type {
  ChargerStatus,
  LocalNowPlaying,
  TimezoneActivity,
} from "@/lib/types";
import { fanout, type PendingEvent } from "@api/fanout";
import type { ListeningEffect } from "@api/ingest-effects";
import { recordChargingSample, recordStateObservation } from "@api/stores/pulse";
import { prepareHeartbeat, prepareStatus } from "@api/stores/charger-store";
import { writeSettlingAt } from "@api/stores/charging-settling";
import { prepareStatus as preparePowerBankStatus } from "@api/stores/powerbank-store";
import { writeLiveness } from "@api/stores/reporter-liveness";
import { prepareCodingActivity, readCodingActivities } from "@api/stores/coding-activity";
import { prepareCodingBuckets } from "@api/stores/coding-buckets";
import { prepareCodingUsage } from "@api/stores/coding-usage";
import type { PreparedTelemetryEnvelope } from "@shared/ingest/telemetry";
import type { StoredCodingActivity } from "@shared/coding-store";
import { isVisibleCodingModel } from "@shared/coding-models";
import { CODING_ACTIVE_MS, CODING_ACTIVITY_STALE_MS } from "@shared/coding-usage";
import { activeDesktop, DESKTOP_ICON_CACHE_LIMIT, desktopPayload, mirror, type PersistedTelemetry, type StoredDesktopActivity, syncTelemetryState, telemetryState } from "@shared/telemetry";

type TelemetryPatch = {
  desktop?: StoredDesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone?: TimezoneActivity | null;
  music?: LocalNowPlaying | null;
  upcomingTracks?: PlayingQueueTrack[];
};

async function persistTelemetryState(
  receivedAt: number,
  patch: TelemetryPatch,
  activeModules: string[],
) {
  const incoming: PersistedTelemetry = {
    desktop: "desktop" in patch ? (patch.desktop ?? null) : telemetryState.desktop,
    desktopIconAssets:
      patch.desktopIconAssets ?? [...telemetryState.desktopIconAssets],
    timezone: "timezone" in patch ? (patch.timezone ?? null) : telemetryState.timezone,
    music: "music" in patch ? (patch.music ?? null) : telemetryState.music,
    upcomingTracks:
      "upcomingTracks" in patch ? (patch.upcomingTracks ?? []) : telemetryState.upcomingTracks,
    activityReceivedAt:
      "desktop" in patch || "music" in patch
        ? receivedAt
        : telemetryState.activityReceivedAt,
    timezoneReceivedAt: "timezone" in patch ? receivedAt : telemetryState.timezoneReceivedAt,
    telemetryReceivedAt: receivedAt,
    activeModules,
  };

  const fields: (keyof PersistedTelemetry & string)[] = ["telemetryReceivedAt", "activeModules"];
  if ("desktop" in patch) fields.push("desktop", "desktopIconAssets", "activityReceivedAt");
  else if ("desktopIconAssets" in patch) fields.push("desktopIconAssets");
  if ("timezone" in patch) fields.push("timezone", "timezoneReceivedAt");
  if ("music" in patch) fields.push("music", "upcomingTracks", "activityReceivedAt");

  await mirror.merge(incoming, fields);
}

/** Map 的插入顺序顺便充当 LRU；每次命中或更新都把该项移到末尾。 */
function rememberDesktopIcon(hash: string, objectKey: string) {
  telemetryState.desktopIconAssets.delete(hash);
  telemetryState.desktopIconAssets.set(hash, objectKey);
  if (telemetryState.desktopIconAssets.size > DESKTOP_ICON_CACHE_LIMIT) {
    const oldest = telemetryState.desktopIconAssets.keys().next().value;
    if (oldest !== undefined) telemetryState.desktopIconAssets.delete(oldest);
  }
}

/**
 * Mac 上报器的唯一入口，状态核心那一半。报文在上报入口收敛（shared/ingest/telemetry.ts）。
 *
 * 一个 envelope 可以只更新一个模块，未出现的模块保持原快照；modules 整个省略
 * （或给个空对象）就是一次纯心跳 —— 靠 presence 和 heartbeatAt 起作用。
 *
 * 每条信封都刷新存活，声明翻转时发一次 presence 事件。
 */
export async function commitPreparedTelemetryEnvelope(command: PreparedTelemetryEnvelope) {
  const { receivedAt, presence, activeModules: nextActiveModules, modules } = command;

  /**
   * 先集中读取这封信封用得着的 SQLite 状态，**全部在这里发起**（commitIngest 注入的是
   * StateHub 本地的 StorageClient，读是本地调用）。「决定读什么」必须早于「分发模块」，
   * 也必须早于这封信封自己的任何写：读到的要是提交前的上一份，diff 和收敛窗口才有意义。
   *
   * 只读这封用得上的：`charger:history` 最多 `CHARGER_HISTORY_LIMIT` 个采样点，无条件读回来
   * 再丢掉不划算。
   */
  const hasChargingDevices = "chargingDevices" in modules;
  const wantsCharger = hasChargingDevices || nextActiveModules.includes("charger");
  const charger = wantsCharger ? readChargerState() : null;
  /**
   * 两台设备各自的「上一次结构变化在什么时候」，收敛窗口要用（lib/charging-settling）。
   * 结构真变了的话这两条是白读的（那种情况不看窗口），代价只是两次本地读。
   */
  const settling = hasChargingDevices
    ? { charger: askSettlingAt("charger"), powerbank: askSettlingAt("powerbank") }
    : null;
  const powerBank = hasChargingDevices ? readPowerBankState() : null;
  /**
   * 这两条每封都要，包括纯心跳：在听和 coding 的观测每封都记一次（见下面那段
   * pulse 的注释），而仲裁「谁在放」要 HomePod 那份快照，算 coding 要此刻的
   * agents。
   */
  const homePod = getHomePodSnapshot();
  const storedCodingActivity = modules.codingActivity
    ? null
    : readCodingActivities().then((activities) => activities.mac ?? null, () => null);
  const [, previousLiveness] = await Promise.all([syncTelemetryState(), readLiveness()]);

  // 落 activeModules 必须排在 syncTelemetryState 后面 —— 它会从库里那份覆盖回来
  telemetryState.activeModules = new Set(nextActiveModules);
  /**
   * envelope.presence 是上报器声明的在离线。
   *
   * 只覆盖优雅离开：退出、睡眠时它抢在断开前发一条 offline，这里立刻把状态
   * 翻过去，不用等心跳窗口。崩溃、断网、强制关机时它发不出这一条，
   * 那些仍然靠 offlineByLiveness 里的心跳窗口兜底 —— 两条路是互补的。
   *
   * 任何一条信封本身都算一次在线心跳；offline 只用于睡眠、退出这类优雅离开。
   */
  const { next: liveness, flipped: presenceFlipped } = nextLiveness(previousLiveness, {
    offline: presence === "offline",
    at: receivedAt,
  });

  /**
   * 这一轮要做的写、推送与首屏失效，收集起来一起交给 fanout：先等写落库，再派发推送
   * 和失效。先后为什么必须是这样，见 workers/api/src/fanout.ts。
   */
  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const notify: PendingEvent[] = [];
  const listening: ListeningEffect[] = [];
  const tags: string[] = [];
  // 这三组都依赖 telemetry fields 真正落库；较晚模块失败时不能推一份未持久化状态。
  const telemetryEvents: PendingEvent[] = [];
  const telemetryListening: ListeningEffect[] = [];
  const telemetryTags: string[] = [];

  let accepted = 0;
  let desktopIconAvailable: boolean | undefined;
  let chargerCoverIconAvailable: boolean | undefined;
  const patch: TelemetryPatch = {};

  /**
   * 存活第一个发车，而且排在模块处理**外面**。
   *
   * 「任何一条信封本身都算一次在线心跳」—— 哪怕其中一个模块写坏了。放进下面
   * 那个 try 里的话，上报器一旦带出个格式错误，每封都 400、每封都不记心跳，
   * 过了心跳窗口整台 Mac 的卡全变灰，而它其实活得好好的、别的模块也还在正常落库。
   */
  writes.push(writeLiveness(liveness));

  /**
   * 在离线翻转本身就是状态变化，值得推 —— 这正是「关键事件」，不是定时广播。
   *
   * 这一条不带数据，浏览器收到后要回源重取一批端点（浏览器侧的 `PRESENCE_PATHS`，
   * 见 src/hooks/use-live-events.ts），所以它得排在写后面，交给 fanout 的 `notify`。
   * 时区不看存活，上下线不用刷它的首屏缓存。
   *
   * 这几行排在模块处理**外面**，和上面那次心跳同一个理由：翻转是这封信封确实
   * 带来的变化，哪怕其中一个模块写坏了也已经写进存活里了，浏览器不该只能等下一轮
   * 轮询才翻过来 —— fanout 的失效和通知都在 `finally` 里，写抛出去也照发。
   */
  if (presenceFlipped) {
    notify.push({ type: "presence", payload: null });
    tags.push(DESKTOP_TAG);
    tags.push(NOW_LISTENING_TAG, CHARGER_TAG);
  }

  /**
   * 模块处理整个包起来，是为了保证「已经发车的写」一定被交给 fanout。
   *
   * 下面的写是 push 进 writes 就开跑的，而后面的模块还可能校验失败抛出去 ——
   * 中途 return 的话，那几个已经发车的写就没人接管，表现是「上报器报了个格式错误，
   * 顺带丢了同一封里已经收下的另外几份数据」。错误照样往上抛，只是先把该落的交出去：
   * `finally` 里的 fanout 先等 writes 落库，推送与首屏失效收成效果，随提交结果返回
   * （见 ingest-effects 的 collectIngestEffects），由普通 Worker 的 waitUntil 派发。
   */
  try {
    if (command.failure?.stage === "beforeCharging") {
      throw new Error(command.failure.message);
    }
    /**
     * 充电设备。
     *
     * `chargingDevices` 是一个设备列表：充电头和充电宝在同一个数组里，靠 `kind` 区分。
     * 两台各自落库、各自推送 —— 一台没在列表里不影响另一台，那正是「只开了其中一个模块」
     * 的正常情况。
     *
     * 不认旧的 `charger` 键：留一条读不到新字段的旧路径，只会在上报器回滚时安静地写进
     * 半截数据。
     */
    let chargerWritten = false;
    if ("chargingDevices" in modules) {
      const device = modules.chargingDevices?.charger ?? null;
      // 只开了充电宝模块时列表里就没有充电头。那不是错误，收下心跳即可。
      if (device) {
        let status = device;
        if (status.cover?.iconHash && status.cover.iconObjectKey) {
          rememberDesktopIcon(status.cover.iconHash, status.cover.iconObjectKey);
        }
        if (status.cover?.iconHash) {
          const storedKey = telemetryState.desktopIconAssets.get(status.cover.iconHash) ?? null;
          if (storedKey) rememberDesktopIcon(status.cover.iconHash, storedKey);
          status = {
            ...status,
            cover: { ...status.cover, iconObjectKey: storedKey },
          };
        }
        chargerCoverIconAvailable =
          status.cover?.iconHash == null || status.cover.iconObjectKey != null;
        if (status.cover?.iconHash) {
          patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
        }
        // 上面早就发车了，这里只是把它接住
        const chargerState = await (charger ?? readChargerState());
        const landing = prepareStatus(status, receivedAt, chargerState);
        writes.push(landing.commit());
        writes.push(recordChargingPulse(receivedAt, status));
        chargerWritten = true;
        /**
         * 插拔、换设备立刻推给浏览器，不等卡片下一次轮询。滚动读数照旧不走这里 ——
         * 除了插拔后那几十秒：采集端在那段时间会追发，功率还在往稳定值收敛，
         * 那几帧值得推。窗口的判断见 lib/charging-settling。
         */
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.charger ?? askSettlingAt("charger")),
        );
        if (window.restart) writes.push(writeSettlingAt("charger", receivedAt));
        if (window.publish) {
          events.push({
            type: "charger",
            payload: chargerPushPayload({
              status,
              receivedAt,
              historyCount: landing.historyCount,
              liveness,
            }),
          });
        }
        // 首屏只关心这一格亮没亮：插着线的功率滚动、收敛窗口里那几帧都只走推送
        if (chargerActive(chargerState.previous?.status) !== chargerActive(status)) tags.push(CHARGER_TAG);
      }

      if (modules.chargingDevices?.failureAfterCharger) {
        throw new Error(modules.chargingDevices.failureAfterCharger);
      }

      const bank = modules.chargingDevices?.powerBank ?? null;
      if (bank) {
        const status = bank;
        const previousBank = await (powerBank ?? readPowerBankState());
        const landing = preparePowerBankStatus(status, receivedAt, previousBank);
        writes.push(landing.commit());
        // 和充电头同一套：插拔、充放电切换、热控翻转、整数电量跳格即时推，加上
        // 插拔之后那段收敛窗口；缓慢滚动的电量和功率仍然等下一次轮询。
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.powerbank ?? askSettlingAt("powerbank")),
        );
        if (window.restart) writes.push(writeSettlingAt("powerbank", receivedAt));
        if (window.publish) {
          events.push({
            type: "powerbank",
            payload: powerBankPushPayload({ status, receivedAt, liveness }),
          });
        }
        if (powerBankActive(previousBank?.status) !== powerBankActive(status)) tags.push(POWERBANK_TAG);
      }
      accepted += 1;
    }
    /**
     * 充电头按「多久没收到推送」判断断流，纯心跳也得给它续上。
     *
     * 上面真收下快照时不用再来一次：prepareStatus 那一批写里已经把这个心跳一起落了。
     */
    if (!chargerWritten && charger && nextActiveModules.includes("charger")) {
      const state = await charger;
      writes.push(prepareHeartbeat(receivedAt, state).commit());
      /**
       * 档位也跟着续。这段时间卡片照旧显示留着的那份快照（过期只由存活和
       * pushedAt 判，而这条心跳正在续 pushedAt），pulse 不跟着确认的话，
       * 序列会在「还插着、还在充」的中间断成一个看起来像上报器死了的缺口。
       */
      if (state.previous) writes.push(recordChargingPulse(receivedAt, state.previous.status));
    }

    if (command.failure?.stage === "beforeDesktop") {
      throw new Error(command.failure.message);
    }

    if ("desktop" in modules) {
      const normalized = modules.desktop!;
      if (normalized.iconObjectKey && normalized.iconHash) {
        rememberDesktopIcon(normalized.iconHash, normalized.iconObjectKey);
      }
      const storedIconObjectKey = normalized.iconHash
        ? (telemetryState.desktopIconAssets.get(normalized.iconHash) ?? null)
        : null;
      if (normalized.iconHash && storedIconObjectKey) {
        rememberDesktopIcon(normalized.iconHash, storedIconObjectKey);
      }
      const activity = normalized.activity
        ? { ...normalized.activity, iconObjectKey: storedIconObjectKey }
        : null;
      desktopIconAvailable = normalized.iconHash == null || storedIconObjectKey != null;
      // 名字立刻推。图标没就位也推 —— 卡着不发的话页头会停在上一个应用，
      // 比短暂的占位符更糟。desktopIconAvailable 仍然回给上报器，让它补图。
      telemetryState.desktop = activity;
      telemetryState.activityReceivedAt = receivedAt;
      patch.desktop = activity;
      patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
      accepted += 1;
      // 页头那一格定宽，换应用只换内容，首屏交给定时重建；上下线的翻转在上面单独失效
      telemetryEvents.push({ type: "desktop", payload: desktopPayload(liveness) });
    }

    if (command.failure?.stage === "beforeTimezone") {
      throw new Error(command.failure.message);
    }

    if ("timezone" in modules) {
      // 时区在可滞后层：整封收下之后由上报入口写 KV（workers/ingress 的 lag-ingest），这里只计数
      accepted += 1;
    }

    if (command.failure?.stage === "beforeAppleMusic") {
      throw new Error(command.failure.message);
    }

    if ("appleMusic" in modules) {
      const { music, upcomingTracks } = modules.appleMusic!;
      const wasLive = liveTrack(telemetryState.music) != null;
      telemetryState.music = music;
      telemetryState.upcomingTracks = upcomingTracks;
      telemetryState.activityReceivedAt = receivedAt;
      patch.music = music;
      patch.upcomingTracks = upcomingTracks;
      accepted += 1;
      /**
       * 只把本次提交对应的 Mac / HomePod 快照收进 effect。StateHub 确认写入后，
       * 普通 Worker 才查 Apple 目录并广播；后台不重读“当前曲目”，避免串到下一封。
       */
      telemetryListening.push(
        listeningEffect(liveness, playableHomePod(await homePod), {
          music,
          receivedAt,
          upcomingTracks,
        }),
      );
      // 换歌、进度只换 hero 里的内容；开始 / 停止放歌才换掉整块 hero
      if (wasLive !== (liveTrack(music) != null)) telemetryTags.push(NOW_LISTENING_TAG);
    }

    if (command.failure?.stage === "beforeAppleMusicCredentials") {
      throw new Error(command.failure.message);
    }

    if ("appleMusicCredentials" in modules) {
      // 只有 music user token 来自那台 Mac；developer token 由 Worker 自签，见 musickit-token.ts。
      // 凭据不进 SQLite：整封收下之后由上报入口写凭据 KV（见 workers/ingress/src/worker.ts 的 commitIngest）
      accepted += 1;
    }

    /**
     * coding 的三份事实各收各的（stores/coding-*）：用量账本换了才重算视图，骨架变了才失效首屏；
     * 活动变了推整份 `coding-now`；token 桶只进 Pulse 与 Jev。三份在上报入口各自校验，
     * 坏的那份在入口就丢了（回执里的 rejected），到这里的都是收下的。
     */
    if (modules.codingUsage) {
      const landing = await prepareCodingUsage("mac", modules.codingUsage, receivedAt);
      writes.push(landing.commit());
      tags.push(...landing.tags);
      accepted += 1;
    }

    let codingActivity: StoredCodingActivity | null = null;
    if (modules.codingActivity) {
      const landing = await prepareCodingActivity("mac", modules.codingActivity, receivedAt, liveness);
      if (landing.accepted) writes.push(landing.commit());
      // 采集时刻比存着的旧（重发、乱序）就不收，观测照旧按存着的那份算
      codingActivity = landing.accepted ? { ...modules.codingActivity, receivedAt } : landing.previous;
      if (landing.event) events.push(landing.event);
      accepted += 1;
    }

    if (modules.codingTokenBuckets) {
      const landing = await prepareCodingBuckets("mac", modules.codingTokenBuckets, receivedAt);
      if (landing.accepted) writes.push(landing.commit());
      accepted += 1;
    }

    /**
     * 在听和 coding 每封都记一次观测，纯心跳也算。
     *
     * 采集端只在内容变化时才带上对应模块，所以「这封没带 appleMusic / desktop」
     * 说的是「没变」，不是「没在听、没在写」。这两笔不能挂在模块出现上：否则一首
     * 长歌、一段稳定的 coding 整段不落笔，时间线中间看起来像上报器死了。
     * 同一状态续区间最多每分钟写一次，见 shared/pulse-timeline。
     *
     * 事实从留着的工作副本 + 这封算出来的存活现算，**不查 Apple 目录**，
     * 两笔都自己吞异常，写坏了不影响 202。
     */
    writes.push(recordListeningPulse(receivedAt, liveness, homePod));
    writes.push(recordCodingPulse(receivedAt, codingActivity ?? storedCodingActivity, presence === "online"));

    // 整封都收下了才落状态：中途抛出去时这份不写（persistTelemetryState 排在所有模块之后）。
    // 存活不同，见上面。只 patch 这封碰过的字段：心跳和换歌并发时，整包 SET 会把 SQLite 里的新歌盖回上一首。
    writes.push(persistTelemetryState(receivedAt, patch, nextActiveModules));
    events.push(...telemetryEvents);
    listening.push(...telemetryListening);
    tags.push(...telemetryTags);
  } finally {
    /**
     * 推送只在模块真的来了才发。
     *
     * 采集端本来就只在内容变化时才带上对应模块，所以「模块出现在 envelope 里」
     * 就是变化信号本身。不带任何模块的纯心跳包不推：过期是时间的函数，卡片的轮询本来
     * 就在判它，每次心跳都广播一份没变化的状态，等于把推送当轮询用。
     *
     * 声明离线、翻回在线的翻转是例外，上面已经单独发了 `presence`；只靠心跳窗口从超时
     * 恢复（没有声明翻转）时，「在线」要等卡片下一轮轮询才显示。换来的是推送通道上只跑
     * 真正的状态变化。
     */
    await fanout({ writes, events, notify, listening, tags });
  }

  return { accepted, heartbeat: true, desktopIconAvailable, chargerCoverIconAvailable };
}

/**
 * 推送当前播放的描述符。
 *
 * 暂停宽限期结束时不由这里补一条：payload 自带 `expiresInMs`，由浏览器把下一次取数
 * 排在那一刻，服务端只对「收到上报」这一件事做出反应，不欠任何未来的动作。
 *
 * 描述符只带这次提交已经捕获的 Mac、HomePod 与存活快照。普通 Worker 收到提交
 * 结果后再查 Apple 目录，不能在后台重读“当前曲目”，否则慢查询会串到下一封上报。
 */
function listeningEffect(
  liveness: Liveness,
  homePod: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks?: PlayingQueueTrack[];
  },
): ListeningEffect {
  const source = mac ?? {
    music: telemetryState.music,
    receivedAt: telemetryState.activityReceivedAt,
    upcomingTracks: telemetryState.upcomingTracks,
  };
  return {
    kind: "listening",
    liveness,
    activeModules: [...telemetryState.activeModules],
    homePod,
    mac: {
      music: source.music,
      receivedAt: source.receivedAt,
      upcomingTracks: source.upcomingTracks ?? [],
    },
  };
}

/**
 * Pulse 听歌道的一次观测：谁在放、放的什么，不查 Apple 目录。
 *
 * HomePod 入口直接使用本次已经规范化并写入的值，不另开一次 SQLite。
 * Mac 那一侧使用已经更新好的工作副本 —— 这封带了 appleMusic 的话它正是新的那份，
 * 没带就是留着的上一份，两种情形都该按同一套规则重算一次。
 *
 * `now` 一律取 `receivedAt`，和区间的时刻同一把钟：HomePod 静默、存活窗口都是时间的函数，
 * 判它们的时刻必须就是这一笔记下来的时刻。
 */
async function recordListeningPulse(
  receivedAt: number,
  liveness: Liveness,
  homePod: Promise<StoredHomePod | null>,
): Promise<void> {
  try {
    const observed = listeningObservation({
      mac: telemetryState.music,
      macObserved: telemetryState.activeModules.has("appleMusic"),
      homePod: await homePod,
    }, liveness, receivedAt);
    await recordStateObservation("listening", receivedAt, observed?.facts ?? null, observed?.hold);
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

async function recordCodingPulse(
  receivedAt: number,
  activity: StoredCodingActivity | null | Promise<StoredCodingActivity | null>,
  online: boolean,
): Promise<void> {
  try {
    /**
     * agent 在不在跑从 Mac 的活动报告现算：最近一条用量事件在 5 分钟内就算在跑。
     *
     * 这封没带就用存着的那份，但要过两道闸，和前台应用一样：coding 模块关掉之后存着的还是
     * 最后那份；采集器死了而 Mac 还在心跳时也是 —— 活动报告内容不变也至少 5 分钟重发一次，
     * 采集时刻 10 分钟没前进就当未知，不能把最后那份一直算下去。
     */
    const report = await activity;
    const usable = report !== null && telemetryState.activeModules.has("coding")
      && receivedAt - report.collectedAt <= CODING_ACTIVITY_STALE_MS;
    const agents = usable
      ? report.agents.map((agent) => ({
        id: agent.id,
        model: isVisibleCodingModel(agent.model) ? agent.model.slice(0, 80) : null,
        active: agent.lastActivityAt != null && agent.lastActivityAt <= receivedAt + 60_000 && receivedAt - agent.lastActivityAt <= CODING_ACTIVE_MS,
      }))
      : null;
    /**
     * 前台应用要过 activeModules 那道闸，和 desktopPayload 同一份判断。
     * 只看工作副本非空的话，desktop 模块关掉之后留着的那份还会被下一封
     * 活动报告捡起来，把早就关掉的编辑器一直算成在写代码。
     */
    const desktop = activeDesktop();
    // 三色带与 Jev 都从这份原始观测现算；不再另写一条档位序列。
    await recordCodingObservation({
      t: receivedAt,
      available: online && (desktop !== null || agents !== null),
      desktop: desktop ? { application: desktop.applicationName.slice(0, 80), coding: isCodingApp(desktop.bundleIdentifier, desktop.applicationName) } : null,
      agents,
    });
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

/** 充电头的实测瓦数。同样自己吞异常 —— 时间线是次要的，不能让一封好好的上报变成 500。 */
async function recordChargingPulse(receivedAt: number, status: ChargerStatus): Promise<void> {
  const device = status.cover?.name ?? status.ports.find((port) => port.active)?.device ?? null;
  await recordChargingSample(receivedAt, status.connected ? status.totalPower : 0, device);
}

/**
 * HomePod 那条入口：Mac 工作副本和存活一起读取。推送只收集可序列化描述符，
 * Apple 目录补充交给普通 Worker；Pulse 听歌道仍在 DO 内按裸快照记一笔。
 */
export function homePodListening(stored: StoredHomePod): {
  effect: Promise<ListeningEffect>;
  pulse: Promise<void>;
} {
  const ready = Promise.all([syncTelemetryState(), readLiveness()]);
  return {
    effect: ready.then(([, liveness]) =>
      listeningEffect(liveness, playableHomePod(stored)),
    ),
    pulse: ready.then(
      ([, liveness]) =>
        recordListeningPulse(
          stored.receivedAt,
          liveness,
          Promise.resolve(stored),
        ),
      (error) => {
        console.error("[pulse]", error instanceof Error ? error.message : String(error));
      },
    ),
  };
}
