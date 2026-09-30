import Foundation

struct CodingUsageTotals: Decodable, Sendable, Equatable {
    let inputTokens: Double
    let outputTokens: Double
    let cacheReadTokens: Double
    let cacheCreationTokens: Double
    let reasoningTokens: Double
    let totalTokens: Double
    let apiEquivalentCostUSD: Double
    /// false：有模型没有价目，成本是下限
    let costComplete: Bool
    let activeDays: Int
    let sessionCount: Int?
}

struct CodingUsageDayTotals: Decodable, Sendable, Equatable {
    let date: String
    let totalTokens: Double
    let apiEquivalentCostUSD: Double
    let costComplete: Bool
}

struct CodingUsageSourceStatus: Decodable, Sendable, Equatable {
    /// mac / agents / agents-otlp
    let source: String
    /// ok / error / superseded / conflict
    let state: String
    let collectedAt: Double?
    let error: String?
    let warning: String?
}

struct CodingUsageAgentView: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let sources: [String]
    let models: [String]
    let latestModel: String?
    let lastDay: CodingUsageDayTotals?
    let status: [CodingUsageSourceStatus]

    /// 有来源采集失败时，读数旁标 Partial，不把缺的那部分当成 0
    var isPartial: Bool { status.contains { $0.state == "error" } }
}

struct CodingModelTokens: Decodable, Sendable, Equatable {
    let model: String
    let tokens: Double
}

struct CodingUsagePayload: Decodable, Sendable, Equatable {
    let updatedAt: Double?
    let totals: CodingUsageTotals?
    let topModels: [CodingModelTokens]
    let agents: [CodingUsageAgentView]
}

struct CodingActivity: Decodable, Sendable, Equatable {
    let source: String
    let lastActivityAt: Double
    let model: String?
}

struct CodingNowAgent: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let activity: [CodingActivity]

    var lastActivityAt: Double { activity.map(\.lastActivityAt).max() ?? 0 }
}

struct CodingNowPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let agents: [CodingNowAgent]
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double
}

/**
 年度热力图。`days[i]` 是 `origin` 往后第 i 天的 token 数；`mix` 每行是
 `[天偏移, 模型下标, token, 模型下标, token, …]`，App 只用 `days`。
 */
struct CodingYearPayload: Decodable, Sendable, Equatable {
    /// YYYY-MM-DD
    let origin: String
    let days: [Double]
    let models: [String]
    let updatedAt: Double
    /// 来源侧的「今天」，YYYY-MM-DD
    let todayAtSource: String
}

struct VibeCodingPlan: Decodable, Sendable, Equatable {
    let tier: String
    let label: String
}

struct VibeCodingLimit: Decodable, Sendable, Equatable, Identifiable {
    let key: String
    let label: String?
    let group: String?
    let windowMinutes: Double?
    let usedPercent: Double
    /// **Unix 秒**，不是毫秒
    let resetsAt: Double?

    var id: String { key }
}

struct AgentLimitsRow: Decodable, Sendable, Equatable {
    let plan: VibeCodingPlan?
    let limits: [VibeCodingLimit]
    let limitsError: String?
    let updatedAt: Double
}

struct AgentLimitsPayload: Decodable, Sendable, Equatable {
    let agents: [String: AgentLimitsRow]
}

enum AgentIndicator: String, LenientStringEnum, Equatable {
    case operational, degraded
    case partialOutage = "partial_outage"
    case majorOutage = "major_outage"
    case maintenance, unavailable, unmonitored
    static let unknownCase = AgentIndicator.unavailable
}

struct AgentStatusComponent: Decodable, Sendable, Equatable {
    let name: String
    let indicator: AgentIndicator
}

struct AgentIncident: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: String
    let url: String
    let updatedAt: Date?

    private enum CodingKeys: String, CodingKey { case id, title, status, url, updatedAt }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        status = try container.decode(String.self, forKey: .status)
        url = try container.decode(String.self, forKey: .url)
        // 契约是 ISO 字符串；站点的开发夹具在这里放的是毫秒数，两种都认
        if let text = try? container.decodeIfPresent(String.self, forKey: .updatedAt) {
            updatedAt = ISO8601Parsing.date(text)
        } else if let milliseconds = try? container.decodeIfPresent(Double.self, forKey: .updatedAt) {
            updatedAt = Date(epochMilliseconds: milliseconds)
        } else {
            updatedAt = nil
        }
    }
}

struct AgentStatusRow: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    let indicator: AgentIndicator
    let statusUrl: String
    let components: [AgentStatusComponent]
    let incidents: [AgentIncident]
    let note: String?
    let stale: Bool
}

struct AgentStatusPayload: Decodable, Sendable, Equatable {
    let fetchedAt: Double
    let agents: [AgentStatusRow]
}
