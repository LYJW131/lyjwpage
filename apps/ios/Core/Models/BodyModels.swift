import Foundation

/**
 站点读到的活动圆环：`src/lib/types.ts#ActivityPayload`。

 这份数据正是这台 iPhone 自己上报上去的（见 `ActivityModule`），App 里读站点这份
 而不是直接读 HealthKit，是为了让 App 看到的和访客看到的是同一个事实。
 */
struct ActivityPayload: Decodable, Sendable, Equatable {
    /// 手表本地的那一天，YYYY-MM-DD
    let date: String
    let secondsFromGMT: Int
    let moveKcal: Double
    let moveGoalKcal: Double
    let exerciseMinutes: Double
    let exerciseGoalMinutes: Double
    let standHours: Double
    let standGoalHours: Double
    let steps: Double?
    let distanceMeters: Double?
    let flightsClimbed: Double?
    let pushedAt: Double
    /// false 表示手表那边已经过了这一天，这份是「昨天」的圈
    let currentAtSource: Bool
}

struct Workout: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let activityType: String
    /// epoch 毫秒
    let startedAt: Double
    let endedAt: Double
    let secondsFromGMT: Int
    /// 扣除暂停后的实际活动时长
    let durationSeconds: Double
    let distanceMeters: Double?
    let activeEnergyKcal: Double?
    let averageHeartRateBpm: Double?
    let maximumHeartRateBpm: Double?
    let elevationAscendedMeters: Double?
    let indoor: Bool?
}

struct WorkoutsPayload: Decodable, Sendable, Equatable {
    let items: [Workout]
    let pushedAt: Double
}
