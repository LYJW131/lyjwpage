import Foundation

// 窗口照抄站点的产品决定，两边才对同一份数据下同一结论；站点改了窗口这里跟着改。
enum Freshness {
    // 源：src/lib/freshness.ts#ACTIVITY_STALE_MS
    static let activityStaleMs: Double = 12 * 60 * 60 * 1000
    // 源：src/lib/freshness.ts#SERVER_STALE_MS
    static let serverStaleMs: Double = 10 * 60 * 1000
    // 源：src/lib/freshness.ts#PLAYSTATION_STALE_MS
    static let playstationStaleMs: Double = 95 * 60 * 1000
    // 源：src/lib/freshness.ts#AGENT_LIMITS_STALE_MS
    static let agentLimitsStaleMs: Double = 185 * 60 * 1000
    // 源：src/lib/coding-agents.ts#CODING_ACTIVE_WINDOW_MS
    static let codingActiveWindowMs: Double = 5 * 60 * 1000

    // 源：src/lib/freshness.ts#isStale
    static func isStale(now: Date, at: Double?, windowMs: Double, declaredOffline: Bool = false) -> Bool {
        if declaredOffline { return true }
        guard let at else { return false }
        return at <= 0 || now.epochMilliseconds - at > windowMs
    }

    static func macIsStale(_ presence: (any ReporterPresence)?, now: Date) -> Bool {
        guard let presence else { return true }
        return isStale(
            now: now, at: presence.lastSeenAt,
            windowMs: presence.heartbeatWindowMs,
            declaredOffline: presence.declaredOffline
        )
    }

    // 源：src/lib/freshness.ts#liveChargingFeed、src/lib/freshness.ts#chargingFeedClockStale
    static func chargingFeedIsLive(connected: Bool, pushedAt: Double, staleAfterMs: Double, presence: any ReporterPresence, now: Date) -> Bool {
        guard connected, !macIsStale(presence, now: now) else { return false }
        return !isStale(now: now, at: pushedAt, windowMs: staleAfterMs)
    }
}
