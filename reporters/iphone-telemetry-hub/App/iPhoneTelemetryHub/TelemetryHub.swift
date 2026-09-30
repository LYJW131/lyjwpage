import Foundation

// Cloudflare 浏览器完整性检查可能拦截默认 UA。
enum HubUserAgent {
    static let value: String = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2"
        return "iphone-telemetry-hub/\(version)"
    }()
}

// 接收端按到达顺序替换数据；后台重试旧报文会覆盖较新的读数，不能排队补发。
actor TelemetryHub {
    static let shared = TelemetryHub(modules: Modules.all)

    enum Outcome: Sendable {
        case pushed(Int)
        case unchanged
        case skipped(String)
        case coalesced
        case failed(String)
    }

    private let modules: [any TelemetryModule]
    private var started = false
    private var lastSent: [String: Data] = [:]
    private var lastAttemptAt: Date?
    private var inFlight: Task<Outcome, Never>?

    // 指纹与报文必须共用排序后的编码；字典键序不稳定会把相同内容误判为变化。
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let timeout: TimeInterval = 10

    private static let coalesce: TimeInterval = 60

    // refresh 必须小于 src/lib/freshness.ts 的 ACTIVITY_STALE_MS，避免不变的读数被判陈旧。
    private static let refresh: TimeInterval = 6 * 60 * 60

    init(modules: [any TelemetryModule]) {
        self.modules = modules
    }

    func start() async {
        guard !started else { return }
        started = true

        for module in modules {
            await module.startObserving { [weak self] in
                _ = await self?.report(force: false)
            }
        }
    }

    func report(force: Bool) async -> Outcome {
        if let inFlight {
            return await inFlight.value
        }
        if !force, let last = lastAttemptAt, Date().timeIntervalSince(last) < Self.coalesce {
            return .coalesced
        }

        let task = Task { await self.perform(force: force) }
        inFlight = task
        let outcome = await task.value
        inFlight = nil
        return outcome
    }

    private func perform(force: Bool) async -> Outcome {
        lastAttemptAt = Date()

        guard let destination = HubSettings.destination() else {
            return .skipped("还没填上报地址")
        }

        let enabled = modules.filter { HubSettings.isEnabled($0.id) }
        guard !enabled.isEmpty else { return .skipped("模块全关着") }

        var payloads: [String: AnyEncodable] = [:]
        var encoded: [String: Data] = [:]
        var quiet: [String] = []
        var issues: [String] = []

        for module in enabled {
            do {
                guard let snapshot = try await module.snapshot() else {
                    quiet.append(module.title)
                    continue
                }
                encoded[module.id] = try encoder.encode(snapshot)
                payloads[module.id] = snapshot
            } catch {
                issues.append("\(module.title)：\(error.localizedDescription)")
            }
        }

        if payloads.isEmpty {
            if !issues.isEmpty {
                let message = issues.joined(separator: "；")
                HubSettings.record(error: message)
                return .failed(message)
            }
            return .skipped(quiet.isEmpty ? "没有模块可发" : "\(quiet.joined(separator: "、"))：还没有可上报的数据")
        }

        let stale = HubSettings.lastPush.at.map { Date().timeIntervalSince($0) >= Self.refresh } ?? true
        if !force && !stale {
            let changed = payloads.keys.filter { encoded[$0] != lastSent[$0] }
            guard !changed.isEmpty else { return .unchanged }
            payloads = payloads.filter { changed.contains($0.key) }
        }

        do {
            try await push(TelemetryEnvelope(modules: payloads), to: destination)
            for id in payloads.keys { lastSent[id] = encoded[id] }
            HubSettings.record(error: issues.isEmpty ? nil : issues.joined(separator: "；"))
            return .pushed(payloads.count)
        } catch {
            let message = (error as? HubError)?.description ?? error.localizedDescription
            HubSettings.record(error: message)
            return .failed(message)
        }
    }

    private func push(_ envelope: TelemetryEnvelope, to destination: Destination) async throws {
        var request = URLRequest(url: destination.url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(HubUserAgent.value, forHTTPHeaderField: "User-Agent")
        request.setValue(destination.clientID, forHTTPHeaderField: "CF-Access-Client-Id")
        request.setValue(destination.secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        request.httpBody = try encoder.encode(envelope)
        request.timeoutInterval = Self.timeout

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.timeout
        configuration.timeoutIntervalForResource = Self.timeout
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HubError.badResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HubError.rejected(
                status: http.statusCode,
                body: String(data: data, encoding: .utf8) ?? ""
            )
        }
    }
}

enum HubError: Error, CustomStringConvertible {
    case badResponse
    case rejected(status: Int, body: String)

    var description: String {
        switch self {
        case .badResponse:
            return "上报地址没有返回 HTTP 响应"
        case let .rejected(status, body):
            let reason = Self.reason(from: body)
            return reason.isEmpty ? "站点拒绝了这次上报（HTTP \(status)）" : "HTTP \(status)：\(reason)"
        }
    }

    private static func reason(from body: String) -> String {
        guard let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = object["error"] as? String else {
            return String(body.prefix(120)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return error
    }
}
