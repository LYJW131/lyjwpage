import Foundation

// 读站点这份而不是直接读 HealthKit，App 看到的才和访客是同一个事实。
struct ActivityPayload: Decodable, Sendable, Equatable {
    // 手表本地的那一天。
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
    // false 表示手表已过了这一天，这份是「昨天」的圈。
    let currentAtSource: Bool
}

struct Workout: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let activityType: String
    // epoch 毫秒。
    let startedAt: Double
    let endedAt: Double
    let secondsFromGMT: Int
    // 已扣除暂停。
    let durationSeconds: Double
    let distanceMeters: Double?
    let activeEnergyKcal: Double?
    let elevationAscendedMeters: Double?
    let indoor: Bool?
}

struct WorkoutsPayload: Decodable, Sendable, Equatable {
    let items: [Workout]
    let pushedAt: Double
}
