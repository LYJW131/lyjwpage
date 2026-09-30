import Foundation
// Core/ 也要在 Linux 工具链上编译和跑测试（见 Package.swift），那里的 URLSession 在这个模块里
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/**
 站点对外的读侧入口。

 状态 API 只在 api Worker 上，站点域名本身只出页面、图片（`/img/<objectKey>`）和 `/api/version`。
 GET 不带 `Origin`：api Worker 只拦「带了且不在白名单」的来源，不带就放行；
 推送长连接反过来必须带白名单里的来源，见 `LiveSocket`。
 */
enum SiteHosts {
    static let production = URL(string: "https://api.homepage.lyjw.llc")!

    /**
     从 Xcode 运行时可在 scheme 的环境变量里设 `LYJWPAGE_API=http://localhost:8788`，连本机那套
     Worker（`pnpm dev:worker`），配合 `pnpm dev:override` 看此刻没发生的状态。装到手机上从桌面
     打开的包拿不到这个变量，只连生产。
     */
    static let api: URL = ProcessInfo.processInfo.environment["LYJWPAGE_API"].flatMap(URL.init(string:)) ?? production
    static let site = URL(string: "https://lyjw.me")!
    static var socket: URL { socketURL(for: api) }
    /// 推送长连接握手时自报的来源，必须在 api Worker 的 `ALLOWED_ORIGINS` 里
    static let socketOrigin = "https://lyjw.me"

    static func socketURL(for api: URL) -> URL {
        var components = URLComponents(url: api, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = "/ws"
        return components.url!
    }
}

enum AppIdentity {
    static let version: String = {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "3"
    }()

    /// 发往自家 Worker 的请求一律带这个 UA：Cloudflare 的浏览器完整性检查会拦某些默认 UA
    static let userAgent = "lyjwpage-ios/\(version)"
}

/**
 状态端点（`/api/status/<模块>`）的统一信封：`{ ok: true, data, updatedAt?, servedAt? }` 或 `{ ok: false, error }`。

 上游故障时站点照样回 200、只在信封里标 `ok: false`，所以「请求成功」不等于「有数据」。
 */
struct StatusEnvelope<Payload: Decodable & Sendable>: Decodable, Sendable {
    let data: Payload?
    let error: String?
    /// 只有可滞后层（KV）的视图带：写入方最后一次成功的时刻，epoch 毫秒
    let updatedAt: Double?
    let servedAt: Double?

    private enum CodingKeys: String, CodingKey {
        case ok, data, error, updatedAt, servedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        data = ok ? try container.decode(Payload.self, forKey: .data) : nil
        error = ok ? nil : (try container.decodeIfPresent(String.self, forKey: .error) ?? "Unavailable")
        updatedAt = try container.decodeIfPresent(Double.self, forKey: .updatedAt)
        servedAt = try container.decodeIfPresent(Double.self, forKey: .servedAt)
    }

    init(data: Payload?, error: String?, updatedAt: Double?, servedAt: Double?) {
        self.data = data
        self.error = error
        self.updatedAt = updatedAt
        self.servedAt = servedAt
    }
}

/// 一条状态端点和它的载荷类型。路径与推送事件名的对应规则见根 AGENTS.md「API 命名与跨端契约」
struct StatusEndpoint<Payload: Decodable & Sendable>: Sendable {
    let path: String
}

/// 登记表对着站点的 `src/lib/status-views.ts#STATUS_VIEWS`，只收 App 用得到的那些
enum Status {
    static let desktop = StatusEndpoint<DesktopPayload>(path: "/api/status/desktop")
    static let timezone = StatusEndpoint<TimezonePayload>(path: "/api/status/timezone")
    static let activity = StatusEndpoint<ActivityPayload>(path: "/api/status/activity")
    static let workouts = StatusEndpoint<WorkoutsPayload>(path: "/api/status/workouts")
    static let server = StatusEndpoint<ServerPayload>(path: "/api/status/server")
    static let charger = StatusEndpoint<ChargerPayload>(path: "/api/status/charger")
    static let powerBank = StatusEndpoint<PowerBankPayload>(path: "/api/status/powerbank")
    static let listening = StatusEndpoint<ListeningPayload>(path: "/api/status/listening")
    static let nowListening = StatusEndpoint<NowListeningPayload>(path: "/api/status/listening/now")
    static let coding = StatusEndpoint<CodingUsagePayload>(path: "/api/status/coding")
    static let codingNow = StatusEndpoint<CodingNowPayload>(path: "/api/status/coding/now")
    static let codingYear = StatusEndpoint<CodingYearPayload>(path: "/api/status/coding/year")
    static let limits = StatusEndpoint<AgentLimitsPayload>(path: "/api/status/limits")
    static let agentStatus = StatusEndpoint<AgentStatusPayload>(path: "/api/status/agent-status")
    static let watching = StatusEndpoint<WatchingPayload>(path: "/api/status/watching")
    static let nowWatching = StatusEndpoint<NowWatchingPayload>(path: "/api/status/watching/now")
    static let playing = StatusEndpoint<PlaystationPlayingPayload>(path: "/api/status/playing")
    static let playingNow = StatusEndpoint<PlaystationPresencePayload>(path: "/api/status/playing/now")
    static let trophies = StatusEndpoint<TrophiesSummaryPayload>(path: "/api/status/trophies")
    static let githubRepo = StatusEndpoint<GithubRepoPayload>(path: "/api/status/github-repo")
    static let vercelDeployments = StatusEndpoint<VercelDeploymentsPayload>(path: "/api/status/vercel-deployments")
    static let cloudflareWorkers = StatusEndpoint<CloudflareWorkersPayload>(path: "/api/status/cloudflare-workers")
    static let sentry = StatusEndpoint<SentryStatusPayload>(path: "/api/status/sentry")
    static let reporters = StatusEndpoint<ReportersPayload>(path: "/api/status/reporters")
    static let pulse = StatusEndpoint<PulsePayload>(path: "/api/status/pulse")
}

enum StatusClientError: Error, CustomStringConvertible {
    case http(Int)
    case notHTTP

    var description: String {
        switch self {
        case let .http(status): "HTTP \(status)"
        case .notHTTP: "No HTTP response"
        }
    }
}

struct StatusClient: Sendable {
    let session: URLSession

    static let shared = StatusClient(session: {
        let configuration = URLSessionConfiguration.default
        // 状态端点本来就回 no-store；关掉本地缓存，免得哪天响应头变了读到旧数据
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        return URLSession(configuration: configuration)
    }())

    static let decoder = JSONDecoder()

    func fetch<Payload>(
        _ endpoint: StatusEndpoint<Payload>,
        query: [URLQueryItem] = []
    ) async throws -> StatusEnvelope<Payload> {
        try await get(Self.url(path: endpoint.path, query: query), as: StatusEnvelope<Payload>.self)
    }

    /// 原始响应体。App 把它原样落盘，冷启动时先解这一份垫底，见 `SnapshotCache`
    func raw(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue(AppIdentity.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw StatusClientError.notHTTP }
        // 状态存储还没就绪时是 503，其余非 2xx 也一并当这次没取到
        guard (200..<300).contains(http.statusCode) else { throw StatusClientError.http(http.statusCode) }
        return data
    }

    static func url(path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: SiteHosts.api, resolvingAgainstBaseURL: false)!
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        return components.url!
    }

    static let versionURL = SiteHosts.site.appending(path: "api/version")

    /// 站点此刻在线的那个构建。它在站点域名上，不在 api Worker 上
    func version() async throws -> AppVersionPayload {
        try await get(Self.versionURL, as: AppVersionPayload.self)
    }

    /// 同步歌词。这条不走信封，直接是 `{ lines, songId, error? }`
    func lyrics(songID: String) async throws -> LyricsPayload {
        try await get(Self.url(path: "/api/lyrics", query: [URLQueryItem(name: "song", value: songID)]), as: LyricsPayload.self)
    }

    private func get<T: Decodable>(_ url: URL, as type: T.Type) async throws -> T {
        let data = try await raw(url)
        return try Self.decoder.decode(T.self, from: data)
    }
}
