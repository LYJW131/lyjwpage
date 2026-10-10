import Foundation

struct ActiveCodingAgent: Equatable, Sendable, Identifiable {
    let id: String
    let source: String
    let model: String?
    let lastActivityAt: Double

    var isCloud: Bool { source != "mac" }
}

enum MacState: Equatable, Sendable {
    case app(DesktopActivity)
    case hidden
    case locked
    case offline
    case unknown
}

// 判断放在 Core 以便脱离 UI 框架测试；都吃显式的 now，视图靠 TimelineView 推时刻，过期才会自己翻过来。
extension LiveStore {
    func macState(now: Date) -> MacState {
        guard let desktop else { return .unknown }
        if Freshness.macIsStale(desktop, now: now) { return .offline }
        guard let activity = desktop.desktop else { return .offline }
        if activity.isHidden { return .hidden }
        if activity.isLockScreen { return .locked }
        return .app(activity)
    }

    func liveListening(now: Date) -> NowListeningPayload? {
        guard let payload = nowListening else { return nil }
        return payload.live(macOffline: Freshness.macIsStale(payload, now: now))
    }

    func liveTrack(now: Date) -> LocalNowPlaying? {
        guard let music = liveListening(now: now)?.music, music.isLive, music.homepodStillVisible(at: now) else { return nil }
        return music
    }

    func listeningItem(for payload: NowListeningPayload?) -> ListeningItem? {
        guard let id = payload?.id else { return nil }
        return listening?.items.first { $0.id == id }
    }

    // 源：src/app/page.tsx 里充电位的判断
    func chargerIsActive(now: Date) -> Bool {
        guard let charger else { return false }
        let live = Freshness.chargingFeedIsLive(
            connected: charger.connected, pushedAt: charger.pushedAt,
            staleAfterMs: charger.staleAfterMs, presence: charger, now: now
        )
        return live && charger.totalPower > 1
    }

    func powerBankIsActive(now: Date) -> Bool {
        guard let powerBank else { return false }
        let live = Freshness.chargingFeedIsLive(
            connected: powerBank.connected, pushedAt: powerBank.pushedAt,
            staleAfterMs: powerBank.staleAfterMs, presence: powerBank, now: now
        )
        return live && (powerBank.charging || powerBank.outputPower > 1)
    }

    // Mac 亲口离线时 mac 那一路作废。源：src/lib/coding-agents.ts#liveCodingActivity
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

    func limitsAreStale(_ row: AgentLimitsRow, now: Date) -> Bool {
        Freshness.isStale(now: now, at: row.updatedAt, windowMs: Freshness.agentLimitsStaleMs)
    }

    // 站点给的百分比已推算到它出响应那一刻，这里只补此后经过的时间。
    func nowWatchingProgress(now: Date) -> Double? {
        guard let playing = nowWatching?.nowPlaying, let base = playing.progress else { return nil }
        guard !playing.paused, let duration = playing.durationMs, duration > 0, let at = nowWatchingAt else { return base }
        let advanced = base + max(0, now.epochMilliseconds - at) / duration * 100
        return min(max(advanced, 0), 100)
    }

    var nowWatchingItem: (playing: ResolvedNowPlaying, item: WatchingItem?)? {
        guard let playing = nowWatching?.nowPlaying else { return nil }
        return (playing, nowWatching?.current)
    }
}
