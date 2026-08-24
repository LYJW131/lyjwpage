import Foundation

/**
 收集各模块 → 拼信封 → POST。整个 App 只有这一条上报链路。

 **节奏由系统定，不由我们定。** 唯一的后台唤醒源是各模块自己的（活动圆环那个是
 HealthKit 的观测，按小时节流），所以别指望分钟级 —— 站点那边的卡片因此按 5 分钟
 轮询，也因此不把「很久没收到」当成掉线。真要更快只有一条路：把 App 切到前台。

 **失败了不补发。** 站点那侧是「后到的就是对的」、整份替换，没有顺序闸；这里要是加了
 后台重试队列（`URLSession` 的 background 那套），一封迟到的旧报文就会把已经涨上去的
 数按回去。两边是一对，要改一起改。
 */
actor TelemetryHub {
    static let shared = TelemetryHub(modules: Modules.all)

    enum Outcome: Sendable {
        /// 发出去了，带上这封里有几个模块
        case pushed(Int)
        /// 所有模块的内容都和上次发出去的一样，没必要再发一遍
        case unchanged
        /// 还没配好、模块全关着、当天还没有数据之类，不是错误
        case skipped(String)
        /// 被合并窗口挡掉了。单独一种，是因为界面**不该**拿它盖掉上一句 ——
        /// 「还没填上报地址」比「刚上报过」有用得多，而回前台时这两次调用挨得很近
        case coalesced
        case failed(String)
    }

    private let modules: [any TelemetryModule]
    private var started = false
    /// 模块 id → 上次**成功发出去**的那份字节。变没变就靠它比
    private var lastSent: [String: Data] = [:]
    private var lastAttemptAt: Date?
    private var inFlight: Task<Outcome, Never>?

    /**
     指纹和真正发出去的字节共用这一个编码器。

     两套配置早晚会飘，飘了之后要么每轮都误判成「变了」白发一遍，要么反过来把
     真变化吞掉 —— 后者是那种放一整天都发现不了的坏法。`sortedKeys` 是关键：
     字典的键序默认不稳定，不排的话同一份数据每次编出来都不一样。
     */
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    /// 单次请求的上限。观测回调那条路上，实例随时可能被系统挂起，不能久等
    private static let timeout: TimeInterval = 10

    /**
     多个模块的唤醒几乎同时响，这个窗口把它们并成一封。

     活动圆环一个模块就观测着四个 HealthKit 类型，少了它一次数据变化会连打四次站点。
     */
    private static let coalesce: TimeInterval = 60

    /// 内容没变也隔这么久重发一次，好让站点那份 7 天 TTL 的快照不会过期消失
    private static let refresh: TimeInterval = 6 * 60 * 60

    init(modules: [any TelemetryModule]) {
        self.modules = modules
    }

    /**
     让每个模块注册自己的唤醒源。每次启动都要跑一遍（见 AppDelegate 的注释）。

     授权没点头时照样注册：那时模块的 snapshot 拿不到数据，但用户点头之后不用重启
     App 就能生效。
     */
    func start() async {
        guard !started else { return }
        started = true

        for module in modules {
            await module.startObserving { [weak self] in
                _ = await self?.report(force: false)
            }
        }
    }

    /**
     上报一次。

     `force` 只由界面上那个「立刻上报」按钮传 true —— 它要绕开合并窗口和「内容没变」
     那两道闸，因为人按下按钮时想看到的就是一次真的往返。
     */
    func report(force: Bool) async -> Outcome {
        // 已经有一封在飞了就搭它的车，别并发打两次
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

        /**
         一个模块取数失败不该连累别的模块。

         整封作废的话，往后加了模块之后，一个偶发的取数错误会把当天所有数据一起
         挡在门外 —— 而它们本来是各存各的。
         */
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

        // 内容一个字节没变就不发，除非隔得够久了 —— 站点只在「真的变了」时才该被打扰
        let stale = HubSettings.lastPush.at.map { Date().timeIntervalSince($0) >= Self.refresh } ?? true
        if !force && !stale {
            let changed = payloads.keys.filter { encoded[$0] != lastSent[$0] }
            guard !changed.isEmpty else { return .unchanged }
            payloads = payloads.filter { changed.contains($0.key) }
        }

        do {
            try await push(TelemetryEnvelope(modules: payloads), to: destination)
            // 只更新真的发出去了的那几个模块
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
        if !destination.secret.isEmpty {
            request.setValue("Bearer \(destination.secret)", forHTTPHeaderField: "Authorization")
        }
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
            // 把站点的错误原文带出来：它回的是 {"ok":false,"error":"..."}，
            // 那句中文比「HTTP 400」有用得多
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
