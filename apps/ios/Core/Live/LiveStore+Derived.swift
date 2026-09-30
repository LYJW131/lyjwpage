import Foundation

struct ActiveCodingAgent: Equatable, Sendable, Identifiable {
    let id: String
    /// mac / agents / agents-otlp：亮灯那条事件是哪一路报的
    let source: String
    let model: String?
    let lastActivityAt: Double

    /// 云端来源（Claude Code 云端遥测、Cursor 账号侧）不在 Mac 上
    var isCloud: Bool { source != "mac" }
}

/// Mac 前台那一栏此刻该怎么写
enum MacState: Equatable, Sendable {
    case app(DesktopActivity)
    /// 隐私开关打开：站点写 Hidden
    case hidden
    case locked
    /// 心跳过窗或亲口离线
    case offline
    /// 还没取到过
    case unknown
}

/**
 从手上的原始载荷推「此刻该显示什么」，规则对着站点首页的那几处判断。放在 Core 里而不是
 视图里，是为了能在没有 UI 框架的地方编译和测试。所有判断都吃一个 `now`：视图用
 `TimelineView` 按固定间隔给它新时刻，过期才会自己翻过来。
 */
extension LiveStore {
    func macState(now: Date) -> MacState {
        guard let desktop else { return .unknown }
        if Freshness.macIsStale(desktop, now: now) { return .offline }
        guard let activity = desktop.desktop else { return .offline }
        if activity.isHidden { return .hidden }
        if activity.isLockScreen { return .locked }
        return .app(activity)
    }

    /// 此刻真在听的那一路：Mac 掉线时换成接班的一路（HomePod）
    func liveListening(now: Date) -> NowListeningPayload? {
        guard let payload = nowListening else { return nil }
        return payload.live(macOffline: Freshness.macIsStale(payload, now: now))
    }

    func liveTrack(now: Date) -> LocalNowPlaying? {
        guard let music = liveListening(now: now)?.music, music.isLive else { return nil }
        return music
    }

    /// 站点列表里和正在听同一张专辑 / 歌单的那一条：有模板封面和配色
    func listeningItem(for payload: NowListeningPayload?) -> ListeningItem? {
        guard let id = payload?.id else { return nil }
        return listening?.items.first { $0.id == id }
    }

    /// 首页充电位：充电头有实际输出（大于 1 W）才出现。源：src/app/page.tsx 里充电位的判断
    func chargerIsActive(now: Date) -> Bool {
        guard let charger else { return false }
        let live = Freshness.chargingFeedIsLive(
            connected: charger.connected, pushedAt: charger.pushedAt,
            staleAfterMs: charger.staleAfterMs, presence: charger, now: now
        )
        return live && charger.totalPower > 1
    }

    /// 充电宝：在充、或者在往外放电（大于 1 W）才出现
    func powerBankIsActive(now: Date) -> Bool {
        guard let powerBank else { return false }
        let live = Freshness.chargingFeedIsLive(
            connected: powerBank.connected, pushedAt: powerBank.pushedAt,
            staleAfterMs: powerBank.staleAfterMs, presence: powerBank, now: now
        )
        return live && (powerBank.charging || powerBank.outputPower > 1)
    }

    /**
     此刻在用的 agent：取它最近一条可信的用量事件（Mac 亲口离线时 mac 那一路作废），离此刻不超过
     `codingActiveWindowMs` 就亮灯。源：src/lib/coding-agents.ts#liveCodingActivity
     */
    func activeCodingAgents(now: Date) -> [ActiveCodingAgent] {
        guard let codingNow else { return [] }
        return codingNow.agents.compactMap { agent in
            let live = agent.activity
                .filter { !(codingNow.declaredOffline && $0.source == "mac") }
                .max { $0.lastActivityAt < $1.lastActivityAt }
            guard let live, now.epochMilliseconds - live.lastActivityAt <= Freshness.codingActiveWindowMs else { return nil }
            return ActiveCodingAgent(id: agent.id, source: live.source, model: live.model, lastActivityAt: live.lastActivityAt)
        }
        .sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    /// 圆环超过 `activityStaleMs` 没有新读数就写 Unavailable
    func activityIsStale(now: Date) -> Bool {
        guard let activity else { return true }
        return Freshness.isStale(now: now, at: activity.pushedAt, windowMs: Freshness.activityStaleMs)
    }

    func serverIsStale(now: Date) -> Bool {
        guard let server else { return true }
        return Freshness.isStale(now: now, at: server.pushedAt, windowMs: Freshness.serverStaleMs)
    }

    func playstationIsStale(now: Date) -> Bool {
        guard let playingNow else { return true }
        return Freshness.isStale(now: now, at: playingNow.observedAt, windowMs: Freshness.playstationStaleMs)
    }

    /// 某个 agent 的限额这一行是不是太久没更新
    func limitsAreStale(_ row: AgentLimitsRow, now: Date) -> Bool {
        Freshness.isStale(now: now, at: row.updatedAt, windowMs: Freshness.agentLimitsStaleMs)
    }

    /**
     Emby 此刻的进度（0–100）。站点给的百分比已推算到它出响应的那一刻；没暂停时再按经过的时间
     往前推，和站点一样不等下一次推送。
     */
    func nowWatchingProgress(now: Date) -> Double? {
        guard let playing = nowWatching?.nowPlaying, let base = playing.progress else { return nil }
        guard !playing.paused, let duration = playing.durationMs, duration > 0, let at = nowWatchingAt else { return base }
        let advanced = base + max(0, now.epochMilliseconds - at) / duration * 100
        return min(max(advanced, 0), 100)
    }

    /// 站点上线的构建里，这一刻在 Emby 上播的那一集
    var nowWatchingItem: (playing: ResolvedNowPlaying, item: WatchingItem?)? {
        guard let playing = nowWatching?.nowPlaying else { return nil }
        return (playing, nowWatching?.current)
    }
}
