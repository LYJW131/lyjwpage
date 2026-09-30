import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/**
 站点的推送长连接，和浏览器连的是同一条：`wss://…/ws?visible=1`，消息见 `LiveEvent`。

 握手必须带白名单里的 `Origin`（api Worker 对 `/ws` 缺来源一律 403），所以这里自报站点域名，
 和仓库里本地开发的上游中继是同一个做法。连着就会算进站点页脚的「Online now」，所以只在
 App 前台时连，退到后台由 `LiveStore.deactivate` 关掉 —— 那正是访客关掉标签页的语义。

 心跳和重连照浏览器端：每 `heartbeatInterval` 发一次 `"ping"`（服务端自动回 `"pong"`，
 超过 30 分钟没动静的连接会被它关掉）；断了按 1.5 倍退避重连，封顶 30 秒。源：
 shared/live-heartbeat.ts#LIVE_HEARTBEAT_MS、src/hooks/use-live-events.ts
 */
@MainActor
final class LiveSocket {
    enum State: Equatable, Sendable {
        case closed, connecting, open
    }

    static let heartbeatInterval: Duration = .seconds(30)

    private(set) var state: State = .closed
    var onEvent: ((LiveEvent) -> Void)?
    /// 连上了。`reconnected` 为真表示之前连上过、中间断过，断开期间的推送都漏了
    var onOpen: ((_ reconnected: Bool) -> Void)?
    var onStateChange: ((State) -> Void)?

    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var receiver: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var attempt = 0
    private var everOpened = false
    private var wanted = false

    /// 回前台时立刻连，不等退避计时：那一刻最需要看到最新状态
    func connect() {
        wanted = true
        retry?.cancel()
        retry = nil
        guard task == nil else { return }
        open()
    }

    func disconnect() {
        wanted = false
        retry?.cancel()
        retry = nil
        teardown()
        setState(.closed)
    }

    private func open() {
        var components = URLComponents(url: SiteHosts.socket, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "visible", value: "1")]
        var request = URLRequest(url: components.url!)
        request.setValue(SiteHosts.socketOrigin, forHTTPHeaderField: "Origin")
        request.setValue(AppIdentity.userAgent, forHTTPHeaderField: "User-Agent")

        let task = session.webSocketTask(with: request)
        self.task = task
        setState(.connecting)
        task.resume()
        receiver = Task { [weak self] in await self?.receive(on: task) }
        heartbeat = Task { [weak self] in await self?.beat(on: task) }
    }

    private func receive(on task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                guard self.task === task else { return }
                // 服务端连上就先发一条 online，第一条消息到了就算连通
                if state != .open { markOpen() }
                handle(message)
            } catch {
                guard self.task === task else { return }
                dropped()
                return
            }
        }
    }

    private func beat(on task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: Self.heartbeatInterval)
            guard !Task.isCancelled, self.task === task else { return }
            try? await task.send(.string("ping"))
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case let .string(text):
            guard text != "pong" else { return }
            data = Data(text.utf8)
        case let .data(bytes):
            data = bytes
        @unknown default:
            return
        }
        // 解不开的单条消息丢掉就好，不值得为它断开整条连接
        guard let event = try? StatusClient.decoder.decode(LiveEvent.self, from: data) else { return }
        onEvent?(event)
    }

    private func markOpen() {
        attempt = 0
        let reconnected = everOpened
        everOpened = true
        setState(.open)
        onOpen?(reconnected)
    }

    private func dropped() {
        teardown()
        setState(.closed)
        guard wanted else { return }
        let delay = min(pow(1.5, Double(attempt)), 30)
        attempt += 1
        retry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self else { return }
            self.retry = nil
            if self.wanted { self.open() }
        }
    }

    private func teardown() {
        receiver?.cancel()
        heartbeat?.cancel()
        receiver = nil
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func setState(_ next: State) {
        guard state != next else { return }
        state = next
        onStateChange?(next)
    }
}
