import Foundation
import Observation

// 只在前台工作：后台唯一该做的是上报（TelemetryHub），不取任何状态。
// 推送和轮询会交错，带代际戳的几路按戳比较、旧的丢掉，规则对着 `src/lib/status-reads.ts#STAMPS`。
@MainActor
@Observable
final class LiveStore {
    var desktop: DesktopPayload?
    var timezone: TimezonePayload?
    var activity: ActivityPayload?
    var workouts: WorkoutsPayload?
    var server: ServerPayload?
    var charger: ChargerPayload?
    var powerBank: PowerBankPayload?
    var listening: ListeningPayload?
    var nowListening: NowListeningPayload?
    var coding: CodingUsagePayload?
    var codingNow: CodingNowPayload?
    var codingYear: CodingYearPayload?
    var limits: AgentLimitsPayload?
    var agentStatus: AgentStatusPayload?
    var watching: WatchingPayload?
    var nowWatching: NowWatchingPayload?
    // progress 推算到的时刻（站点出响应时；推送按收到时），epoch 毫秒。
    var nowWatchingAt: Double?
    var playing: PlaystationPlayingPayload?
    var playingNow: PlaystationPresencePayload?
    var trophies: TrophiesSummaryPayload?
    var githubRepo: GithubRepoPayload?
    var vercelDeployments: VercelDeploymentsPayload?
    var cloudflareWorkers: CloudflareWorkersPayload?
    var sentry: SentryStatusPayload?
    var reporters: ReportersPayload?
    var pulse: PulsePayload?
    var siteVersion: AppVersionPayload?

    var online: Int?
    var socketState: LiveSocket.State = .closed
    private(set) var failures: [FeedKey: String] = [:]

    @ObservationIgnored private let client: StatusClient
    @ObservationIgnored private let cache: SnapshotCache
    @ObservationIgnored private let socket = LiveSocket()
    @ObservationIgnored private var nextDue: [FeedKey: Date] = [:]
    @ObservationIgnored private var updatedAt: [FeedKey: Double] = [:]
    @ObservationIgnored private var inFlight: Set<FeedKey> = []
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var restored = false

    // 必须短于各路自己的间隔；它只决定到期后最多晚多少秒取。
    private static let tick: Duration = .seconds(5)

    init(client: StatusClient = .shared, cache: SnapshotCache = SnapshotCache()) {
        self.client = client
        self.cache = cache
        socket.onEvent = { [weak self] event in self?.receive(event) }
        socket.onOpen = { [weak self] reconnected in
            guard let self, reconnected else { return }
            // 断开期间漏掉的推送只能回源补：实时层整轮重取
            for key in FeedKey.allCases where key.isRealtime { self.nextDue[key] = .distantPast }
            Task { await self.runDue() }
        }
        socket.onStateChange = { [weak self] state in self?.socketState = state }
    }

    func activate() {
        if !restored {
            restored = true
            restoreSnapshots()
        }
        socket.connect()
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.runDue()
                try? await Task.sleep(for: Self.tick)
            }
        }
    }

    func deactivate() {
        loop?.cancel()
        loop = nil
        socket.disconnect()
    }

    func refreshAll() async {
        await withTaskGroup(of: Void.self) { group in
            for key in FeedKey.allCases {
                group.addTask { await self.load(key) }
            }
        }
    }

    func refresh(_ keys: [FeedKey]) async {
        await withTaskGroup(of: Void.self) { group in
            for key in keys {
                group.addTask { await self.load(key) }
            }
        }
    }

    func failure(_ key: FeedKey) -> String? { failures[key] }

    private func runDue() async {
        let now = Date()
        let due = FeedKey.allCases.filter { (nextDue[$0] ?? .distantPast) <= now && !inFlight.contains($0) }
        guard !due.isEmpty else { return }
        await refresh(due)
    }

    private func load(_ key: FeedKey) async {
        guard !inFlight.contains(key) else { return }
        inFlight.insert(key)
        defer { inFlight.remove(key) }

        let url = key == .version ? StatusClient.versionURL : StatusClient.url(path: key.path)
        do {
            let data = try await client.raw(url)
            let stamp = try ingest(key, data)
            failures[key] = nil
            updatedAt[key] = stamp
            await cache.save(data, for: key)
        } catch {
            failures[key] = (error as? FeedUnavailable)?.reason ?? String(describing: error)
        }
        nextDue[key] = FeedSchedule.nextDue(
            for: key, updatedAt: updatedAt[key], socketLive: socket.state == .open, now: Date()
        )
    }

    private func restoreSnapshots() {
        for key in FeedKey.allCases {
            guard let data = cache.load(key) else { continue }
            if let stamp = try? ingest(key, data) { updatedAt[key] = stamp }
        }
    }

    @discardableResult
    private func ingest(_ key: FeedKey, _ data: Data) throws -> Double? {
        switch key {
        case .desktop: return try apply(data, Status.desktop) { self.accept(desktop: $0) }
        case .timezone: return try apply(data, Status.timezone) { self.timezone = $0 }
        case .activity: return try apply(data, Status.activity) { self.activity = $0 }
        case .workouts: return try apply(data, Status.workouts) { self.workouts = $0 }
        case .server: return try apply(data, Status.server) { self.server = $0 }
        case .charger: return try apply(data, Status.charger) { self.charger = $0 }
        case .powerBank: return try apply(data, Status.powerBank) { self.accept(powerBank: $0) }
        case .listening: return try apply(data, Status.listening) { self.accept(listening: $0) }
        case .nowListening: return try apply(data, Status.nowListening) { self.accept(nowListening: $0) }
        case .coding: return try apply(data, Status.coding) { self.coding = $0 }
        case .codingNow: return try apply(data, Status.codingNow) { self.codingNow = $0 }
        case .codingYear: return try apply(data, Status.codingYear) { self.codingYear = $0 }
        case .limits: return try apply(data, Status.limits) { self.limits = $0 }
        case .agentStatus: return try apply(data, Status.agentStatus) { self.agentStatus = $0 }
        case .watching: return try apply(data, Status.watching) { self.watching = $0 }
        case .nowWatching:
            let envelope = try StatusClient.decoder.decode(StatusEnvelope<NowWatchingPayload>.self, from: data)
            guard let value = envelope.data else { throw FeedUnavailable(reason: envelope.error ?? "Unavailable") }
            setNowWatching(value, at: envelope.servedAt)
            return envelope.updatedAt
        case .playing: return try apply(data, Status.playing) { self.playing = $0 }
        case .playingNow: return try apply(data, Status.playingNow) { self.playingNow = $0 }
        case .trophies: return try apply(data, Status.trophies) { self.accept(trophies: $0) }
        case .githubRepo: return try apply(data, Status.githubRepo) { self.githubRepo = $0 }
        case .vercelDeployments: return try apply(data, Status.vercelDeployments) { self.vercelDeployments = $0 }
        case .cloudflareWorkers: return try apply(data, Status.cloudflareWorkers) { self.cloudflareWorkers = $0 }
        case .sentry: return try apply(data, Status.sentry) { self.sentry = $0 }
        case .reporters: return try apply(data, Status.reporters) { self.reporters = $0 }
        case .pulse: return try apply(data, Status.pulse) { self.pulse = $0 }
        case .version:
            siteVersion = try StatusClient.decoder.decode(AppVersionPayload.self, from: data)
            return nil
        }
    }

    private func apply<P>(_ data: Data, _ endpoint: StatusEndpoint<P>, _ assign: (P) -> Void) throws -> Double? {
        let envelope = try StatusClient.decoder.decode(StatusEnvelope<P>.self, from: data)
        guard let value = envelope.data else { throw FeedUnavailable(reason: envelope.error ?? "Unavailable") }
        assign(value)
        return envelope.updatedAt
    }

    private func receive(_ event: LiveEvent) {
        switch event {
        case let .desktop(payload): accept(desktop: payload)
        case let .nowListening(payload): accept(nowListening: payload)
        case let .listening(payload): accept(listening: payload)
        case let .charger(payload): accept(pushedCharger: payload)
        case let .powerBank(payload): accept(powerBank: payload)
        case let .codingNow(payload): codingNow = payload
        case let .nowWatching(payload): setNowWatching(payload, at: nil)
        case let .watching(payload): watching = payload
        case let .playingNow(payload): playingNow = payload
        case let .playing(payload): playing = payload
        case let .trophies(payload): accept(trophies: payload)
        case .presence:
            Task { await refresh(FeedKey.presenceDependents) }
        case .version:
            Task { await refresh([.version]) }
        case let .online(count):
            online = count
        case .unknown:
            break
        }
    }

    private func setNowWatching(_ payload: NowWatchingPayload, at servedAt: Double?) {
        nowWatching = payload
        nowWatchingAt = servedAt ?? Date().epochMilliseconds
    }

    private func accept(desktop next: DesktopPayload) {
        guard (next.receivedAt ?? 0) >= (desktop?.receivedAt ?? 0) else { return }
        desktop = next
    }

    private func accept(nowListening next: NowListeningPayload) {
        guard (next.receivedAt ?? 0) >= (nowListening?.receivedAt ?? 0) else { return }
        nowListening = next
    }

    private func accept(listening next: ListeningPayload) {
        guard next.fetchedAt >= (listening?.fetchedAt ?? 0) else { return }
        listening = next
    }

    private func accept(powerBank next: PowerBankPayload) {
        guard next.pushedAt >= (powerBank?.pushedAt ?? 0) else { return }
        powerBank = next
    }

    private func accept(trophies next: TrophiesSummaryPayload) {
        guard next.observedAt >= (trophies?.observedAt ?? 0) else { return }
        trophies = next
    }

    // 推送里的充电头 history 永远为空，只能接在已有曲线后面。
    private func accept(pushedCharger next: ChargerPayload) {
        guard next.pushedAt >= (charger?.pushedAt ?? 0) else { return }
        var history = charger?.history ?? []
        if next.connected, history.last?.t != next.pushedAt {
            history.append(ChargerSample(t: next.pushedAt, w: next.totalPower))
        }
        let horizon = next.pushedAt - Self.chargerHistoryWindow * 1000
        charger = next.replacingHistory(history.filter { $0.t >= horizon })
    }

    private static let chargerHistoryWindow: TimeInterval = 30 * 60
}

private struct FeedUnavailable: Error {
    let reason: String
}

extension FeedKey {
    var path: String {
        switch self {
        case .desktop: Status.desktop.path
        case .timezone: Status.timezone.path
        case .activity: Status.activity.path
        case .workouts: Status.workouts.path
        case .server: Status.server.path
        case .charger: Status.charger.path
        case .powerBank: Status.powerBank.path
        case .listening: Status.listening.path
        case .nowListening: Status.nowListening.path
        case .coding: Status.coding.path
        case .codingNow: Status.codingNow.path
        case .codingYear: Status.codingYear.path
        case .limits: Status.limits.path
        case .agentStatus: Status.agentStatus.path
        case .watching: Status.watching.path
        case .nowWatching: Status.nowWatching.path
        case .playing: Status.playing.path
        case .playingNow: Status.playingNow.path
        case .trophies: Status.trophies.path
        case .githubRepo: Status.githubRepo.path
        case .vercelDeployments: Status.vercelDeployments.path
        case .cloudflareWorkers: Status.cloudflareWorkers.path
        case .sentry: Status.sentry.path
        case .reporters: Status.reporters.path
        case .pulse: Status.pulse.path
        case .version: StatusClient.versionURL.path
        }
    }
}

// 只为冷启动不空着；系统随时可清 Caches，清了等同首次打开，不影响正确性。
final class SnapshotCache: Sendable {
    private let directory: URL

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        directory = base.appending(path: "status-snapshots", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func load(_ key: FeedKey) -> Data? {
        try? Data(contentsOf: file(key))
    }

    func save(_ data: Data, for key: FeedKey) async {
        try? data.write(to: file(key), options: .atomic)
    }

    private func file(_ key: FeedKey) -> URL {
        directory.appending(path: "\(key.rawValue).json")
    }
}
