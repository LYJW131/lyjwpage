import Foundation

/**
 App 读的每一路站点数据，以及它在前台时多久取一次。

 节奏照站点浏览器端那一套（`src/lib/status-views.ts#STATUS_VIEWS` 的 `cadenceMs` / `pushCovers`、
 各卡片自己的轮询间隔、`src/lib/poll-schedule.ts`），这样 App 打在 Worker 上的量和多开一个
 浏览器标签页一样，不会因为是原生就更密。App 在后台时一律不取，见 `LiveStore.deactivate`。
 */
enum FeedKey: String, CaseIterable, Sendable {
    case desktop, timezone, activity, workouts, server, charger, powerBank, listening, nowListening
    case coding, codingNow, codingYear, limits, agentStatus, watching, nowWatching, playing, playingNow
    case trophies, githubRepo, vercelDeployments, cloudflareWorkers, sentry, reporters, pulse, version

    enum Policy {
        /// 实时层：`interval` 是卡片自己的轮询间隔；`pushCovers` 为真时推送连着就退成兜底
        case realtime(interval: TimeInterval, pushCovers: Bool)
        /// 可滞后层：写入方的标称节奏，按 `updatedAt + cadence + 宽限` 去取
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

    /// 推送重连后要立刻回源补一次的那些：断开期间漏掉的推送只能靠它补
    var isRealtime: Bool {
        if case .realtime = policy { return true }
        return false
    }

    /// `presence` 事件只是失效通知，收到后重取这几路（它们都靠 Mac 的心跳判活）
    static let presenceDependents: [FeedKey] = [.desktop, .nowListening, .charger, .powerBank, .codingNow]
}

enum FeedSchedule {
    /// 源：src/lib/poll-schedule.ts#PUSH_SAFETY_NET_MS
    static let pushSafetyNet: TimeInterval = 5 * 60
    /// 源：src/lib/poll-schedule.ts#LAG_GRACE_MS
    static let lagGrace: TimeInterval = 15
    /// 源：src/lib/poll-schedule.ts#LAG_MIN_RETRY_MS
    static let lagMinRetry: TimeInterval = 15
    /// 源：src/lib/poll-schedule.ts#LAG_MAX_RETRY_MS
    static let lagMaxRetry: TimeInterval = 5 * 60

    /// 下一次该取的时刻。`updatedAt` 是信封里写入方最后一次成功的时刻（epoch 毫秒）
    static func nextDue(for key: FeedKey, updatedAt: Double?, socketLive: Bool, now: Date) -> Date {
        switch key.policy {
        case let .realtime(interval, pushCovers):
            let effective = socketLive && pushCovers ? max(interval, pushSafetyNet) : interval
            return now.addingTimeInterval(effective)
        case let .lag(cadence):
            return now.addingTimeInterval(lagDelay(updatedAt: updatedAt, cadence: cadence, now: now))
        }
    }

    /// 源：src/lib/poll-schedule.ts#nextLagDelay
    static func lagDelay(updatedAt: Double?, cadence: TimeInterval, now: Date) -> TimeInterval {
        guard let updatedAt else { return cadence }
        let due = Date(epochMilliseconds: updatedAt).addingTimeInterval(cadence + lagGrace)
        if due > now { return max(1, due.timeIntervalSince(now)) }
        let cap = max(lagMinRetry, min(cadence, lagMaxRetry))
        return min(cap, max(lagMinRetry, now.timeIntervalSince(due) / 2))
    }
}
