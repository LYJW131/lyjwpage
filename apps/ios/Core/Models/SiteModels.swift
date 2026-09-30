import Foundation

struct ServerTraffic: Decodable, Sendable, Equatable {
    let cycleStart: Double
    let cycleEnd: Double
    let rxBytes: Double
    let txBytes: Double
    let quotaBytes: Double?
}

struct ServerPayload: Decodable, Sendable, Equatable {
    let id: String
    let hostname: String
    let country: String?
    let city: String?
    let isp: String?
    let asn: Int?
    let os: String
    let kernel: String
    let cpuCores: Int
    let cpuUsagePercent: Double
    let load1: Double
    let memoryTotalBytes: Double
    let memoryUsedBytes: Double
    let diskTotalBytes: Double
    let diskUsedBytes: Double
    let networkRxBytesPerSec: Double
    let networkTxBytesPerSec: Double
    let traffic: ServerTraffic?
    let uptimeSeconds: Double
    let observedAt: Double
    let pushedAt: Double
}

struct AppVersionPayload: Decodable, Sendable, Equatable {
    let commit: String?
    let message: String?
    /// ISO 8601
    let builtAt: String?
}

struct GithubRepoTotals: Decodable, Sendable, Equatable {
    let commits: Int
    let additions: Int
    let deletions: Int
    let contributors: Int
}

struct GithubContributor: Decodable, Sendable, Equatable, Identifiable {
    let login: String
    let avatarUrl: String?
    let commits: Int

    var id: String { login }
}

struct GithubRepoPayload: Decodable, Sendable, Equatable {
    let repo: String
    let fetchedAt: Double
    let totals: GithubRepoTotals?
    let contributors: [GithubContributor]
}

struct DeploymentCommit: Decodable, Sendable, Equatable {
    let sha: String?
    let branch: String?
    let message: String?
}

struct VercelDeployment: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    /// READY / BUILDING / ERROR / QUEUED / CANCELED
    let state: String
    let createdAt: Double
    let buildDurationMs: Double?
    let target: String?
    let commit: DeploymentCommit?
}

struct PageSpeedScores: Decodable, Sendable, Equatable {
    let score: Double?
    let lcpMs: Double?
}

struct PageSpeedSummary: Decodable, Sendable, Equatable {
    let fetchedAt: Double
    let desktop: PageSpeedScores?
    let mobile: PageSpeedScores?
}

struct VercelDeploymentsPayload: Decodable, Sendable, Equatable {
    let fetchedAt: Double
    let production: VercelDeployment?
    let recent: [VercelDeployment]
    let pagespeed: PageSpeedSummary?
}

struct CloudflareWorkerMetrics: Decodable, Sendable, Equatable {
    let requests: Double
    let errors: Double
}

struct CloudflareWorkerDeployment: Decodable, Sendable, Equatable {
    let deployedAt: Double?
    let commit: DeploymentCommit?
}

struct CloudflareWorker: Decodable, Sendable, Equatable, Identifiable {
    let name: String
    let metrics: CloudflareWorkerMetrics?
    let deployment: CloudflareWorkerDeployment?

    var id: String { name }
}

struct CloudflareWorkersPayload: Decodable, Sendable, Equatable {
    let fetchedAt: Double
    let windowStart: Double?
    let windowEnd: Double?
    let workers: [CloudflareWorker]
}

struct SentryUptime: Decodable, Sendable, Equatable {
    /// up / down / …
    let status: String?
    /// 0–1
    let availability30d: Double?
}

struct SentryErrorCounts: Decodable, Sendable, Equatable {
    let count12h: Int?
    let unresolved: Int?
}

struct SentryErrors: Decodable, Sendable, Equatable {
    let site: SentryErrorCounts?
    let worker: SentryErrorCounts?
}

struct SentryStatusPayload: Decodable, Sendable, Equatable {
    let fetchedAt: Double
    let uptime: SentryUptime?
    let errors: SentryErrors?
}

struct ReporterBlock: Decodable, Sendable, Equatable {
    let commit: String?
    let pushes: Int
    let rttMs: Double?
    let lastPushAt: Double
}

struct ReportersPayload: Decodable, Sendable, Equatable {
    let reporters: [String: ReporterBlock?]
}
