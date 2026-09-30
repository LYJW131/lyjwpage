import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// 握手必须带白名单里的 Origin（api Worker 对 /ws 缺来源一律 403），所以自报站点域名。
// 连着就算进站点「Online now」，只能在前台连。心跳与退避照浏览器端，源：shared/live-heartbeat.ts#LIVE_HEARTBEAT_MS、src/hooks/use-live-events.ts
@MainActor
final class LiveSocket {
    enum State: Equatable, Sendable {
        case closed, connecting, open
    }

    static let heartbeatInterval: Duration = .seconds(30)

    private(set) var state: State = .closed
    var onEvent: ((LiveEvent) -> Void)?
    // reconnected 为真表示中间断过，断开期间的推送已漏掉。
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

    // 不等退避计时：回前台那一刻最需要最新状态。
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
