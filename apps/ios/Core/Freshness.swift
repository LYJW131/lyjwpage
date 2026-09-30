import Foundation

/**
 新鲜度规则，对着站点的 `src/lib/freshness.ts`。

 这些窗口是站点的产品决定（多久没更新就写 Unavailable），App 照抄是为了让两边对同一份
 数据下同一个结论。TypeScript 常量没法跨语言共享，所以逐个标出处；站点那边改了窗口，
 这里跟着改。
 */
enum Freshness {
    /// 源：src/lib/freshness.ts#ACTIVITY_STALE_MS
    static let activityStaleMs: Double = 12 * 60 * 60 * 1000
    /// 源：src/lib/freshness.ts#SERVER_STALE_MS
    static let serverStaleMs: Double = 10 * 60 * 1000
    /// 源：src/lib/freshness.ts#PLAYSTATION_STALE_MS
    static let playstationStaleMs: Double = 95 * 60 * 1000
    /// 源：src/lib/freshness.ts#AGENT_LIMITS_STALE_MS
    static let agentLimitsStaleMs: Double = 185 * 60 * 1000
    /// 源：src/lib/coding-agents.ts#CODING_ACTIVE_WINDOW_MS
    static let codingActiveWindowMs: Double = 5 * 60 * 1000

    /// 源：src/lib/freshness.ts#isStale
    static func isStale(now: Date, at: Double?, windowMs: Double, declaredOffline: Bool = false) -> Bool {
        if declaredOffline { return true }
        guard let at else { return false }
        return at <= 0 || now.epochMilliseconds - at > windowMs
    }

    /// Mac 上报器是否掉线：它声明了下线，或最后一次心跳已超出它自己给的窗口
    static func macIsStale(_ presence: (any ReporterPresence)?, now: Date) -> Bool {
        guard let presence else { return true }
        return isStale(
            now: now, at: presence.lastSeenAt,
            windowMs: presence.heartbeatWindowMs,
            declaredOffline: presence.declaredOffline
        )
    }

    /**
     充电头 / 充电宝那一路此刻算不算接着：上报器亲口离线、Mac 心跳过窗、或这一路自己太久没续上，
     都当没接着。源：src/lib/freshness.ts#liveChargingFeed、src/lib/freshness.ts#chargingFeedClockStale
     */
    static func chargingFeedIsLive(connected: Bool, pushedAt: Double, staleAfterMs: Double, presence: any ReporterPresence, now: Date) -> Bool {
        guard connected, !macIsStale(presence, now: now) else { return false }
        return !isStale(now: now, at: pushedAt, windowMs: staleAfterMs)
    }
}
