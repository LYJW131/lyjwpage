import Foundation

struct PlaystationGame: Decodable, Sendable, Equatable, Identifiable {
    let titleId: String
    let name: String
    let category: String?
    let playCount: Int
    let firstPlayedAt: Double?
    let lastPlayedAt: Double?
    let playDurationMs: Double?
    let imageUrl: String?

    var id: String { titleId }
}

struct PlaystationPlayingPayload: Decodable, Sendable, Equatable {
    let observedAt: Double
    let items: [PlaystationGame]
}

struct PlaystationNowPlaying: Decodable, Sendable, Equatable {
    let titleId: String
    let title: String
    let format: String?
    let launchPlatform: String?
    let iconUrl: String?
}

struct PlaystationPresencePayload: Decodable, Sendable, Equatable {
    let observedAt: Double
    let online: Bool
    let availability: String?
    let platform: String?
    let lastOnlineAt: Double?
    let playing: PlaystationNowPlaying?
}

struct TrophyCounts: Decodable, Sendable, Equatable {
    let platinum: Int
    let gold: Int
    let silver: Int
    let bronze: Int

    var total: Int { platinum + gold + silver + bronze }
}

struct TrophyProfile: Decodable, Sendable, Equatable {
    let onlineId: String
    let avatarUrl: String?
    let plus: Bool
    let level: Int
    // 0–100，距下一级的进度。
    let levelProgress: Double
}

enum TrophyType: String, LenientStringEnum, Equatable {
    case platinum, gold, silver, bronze
    static let unknownCase = TrophyType.bronze
}

struct TrophyUnlock: Decodable, Sendable, Equatable {
    let npCommunicationId: String
    let id: Int
    let titleName: String
    let trophyName: String
    let type: TrophyType
    let iconUrl: String?
    let earnedAt: Double

    // id 只在同一个奖杯表里唯一。
    var uniqueID: String { "\(npCommunicationId)-\(id)" }
}

struct TrophyTitleDigest: Decodable, Sendable, Equatable, Identifiable {
    let npCommunicationId: String
    let name: String
    let localizedName: String?
    let titleIds: [String]
    // 0–100
    let progress: Double
    let defined: TrophyCounts
    let earned: TrophyCounts

    var id: String { npCommunicationId }
}

struct TrophiesSummaryPayload: Decodable, Sendable, Equatable {
    let observedAt: Double
    let profile: TrophyProfile
    // 总数用这份，不用 profile 里那份：两边统计时刻不同。
    let earned: TrophyCounts
    let recent: [TrophyUnlock]
    let titles: [TrophyTitleDigest]
}
