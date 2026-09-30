import Foundation

// 节奏照搬浏览器端（`src/lib/status-views.ts#STATUS_VIEWS`、`src/lib/poll-schedule.ts`），App 打在 Worker 上的量才不超过多开一个标签页。
enum FeedKey: String, CaseIterable, Sendable {
    case desktop, timezone, activity, workouts, server, charger, powerBank, listening, nowListening
    case coding, codingNow, codingYear, limits, agentStatus, watching, nowWatching, playing, playingNow
    case trophies, githubRepo, vercelDeployments, cloudflareWorkers, sentry, reporters, pulse, version

    enum Policy {
        // pushCovers 为真时，推送连着就只按兜底间隔取。
        case realtime(interval: TimeInterval, pushCovers: Bool)
        // cadence 是写入方的标称节奏，不是本端轮询间隔。
        case lag(cadence: TimeInterval)
    }

    var policy: Policy {
        switch self {
        case .desktop: .realtime(interval: 60, pushCovers: false)
        case .charger, .powerBank: .realtime(interval: 30, pushCovers: false)
        case .nowListening: .realtime(interval: 60, pushCovers: false)
        case .codingNow: .realtime(interval: 60, pushCovers: false)
        case .listening, .watching, .playing, .trophies: .realtime(interval: 600, pushCovers: true)
        case .nowWatching, .playingNow: .realtime(interval: 60, pushCovers: true)
        case .coding: .realtime(interval: 120, pushCovers: false)
        case .codingYear: .realtime(interval: 600, pushCovers: false)
        case .pulse: .realtime(interval: 300, pushCovers: false)
        case .version: .realtime(interval: 1800, pushCovers: true)
        case .timezone: .lag(cadence: 1800)
        case .activity, .workouts: .lag(cadence: 3600)
        case .server, .agentStatus, .vercelDeployments, .reporters: .lag(cadence: 60)
        case .cloudflareWorkers: .lag(cadence: 120)
        case .limits, .sentry: .lag(cadence: 300)
        case .githubRepo: .lag(cadence: 1800)
        }
    }

    var isRealtime: Bool {
        if case .realtime = policy { return true }
        return false
    }

    // presence 只是失效通知；靠 Mac 心跳判活的路都必须列在这里，否则收到后不会重取。
    static let presenceDependents: [FeedKey] = [.desktop, .nowListening, .charger, .powerBank, .codingNow]
}

enum FeedSchedule {
    // 源：src/lib/poll-schedule.ts#PUSH_SAFETY_NET_MS
    static let pushSafetyNet: TimeInterval = 5 * 60
    // 源：src/lib/poll-schedule.ts#LAG_GRACE_MS
    static let lagGrace: TimeInterval = 15
    // 源：src/lib/poll-schedule.ts#LAG_MIN_RETRY_MS
    static let lagMinRetry: TimeInterval = 15
    // 源：src/lib/poll-schedule.ts#LAG_MAX_RETRY_MS
    static let lagMaxRetry: TimeInterval = 5 * 60

    static func nextDue(for key: FeedKey, updatedAt: Double?, socketLive: Bool, now: Date) -> Date {
        switch key.policy {
        case let .realtime(interval, pushCovers):
            let effective = socketLive && pushCovers ? max(interval, pushSafetyNet) : interval
            return now.addingTimeInterval(effective)
        case let .lag(cadence):
            return now.addingTimeInterval(lagDelay(updatedAt: updatedAt, cadence: cadence, now: now))
        }
    }

    // 源：src/lib/poll-schedule.ts#nextLagDelay
    static func lagDelay(updatedAt: Double?, cadence: TimeInterval, now: Date) -> TimeInterval {
        guard let updatedAt else { return cadence }
        let due = Date(epochMilliseconds: updatedAt).addingTimeInterval(cadence + lagGrace)
        if due > now { return max(1, due.timeIntervalSince(now)) }
        let cap = max(lagMinRetry, min(cadence, lagMaxRetry))
        return min(cap, max(lagMinRetry, now.timeIntervalSince(due) / 2))
    }
}
