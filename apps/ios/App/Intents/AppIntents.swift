import AppIntents
import Foundation

struct ReportTelemetryIntent: AppIntent {
    static let title: LocalizedStringResource = "Report Telemetry"
    static let description = IntentDescription("Sends this iPhone's activity rings and recent workouts to lyjw.me right now.")
    static let supportedModes: IntentModes = .background
    // 只在主 App 进程执行：上报器、HealthKit 授权和钥匙串凭据都只在这个进程里
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = await TelemetryHub.shared.report(force: true)
        return .result(dialog: "\(outcome.summary)")
    }
}

struct NowListeningIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Playing on lyjw.me"
    static let description = IntentDescription("Tells you what's playing on the Mac or HomePod right now.")
    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let envelope = try await StatusClient.shared.fetch(Status.nowListening)
        let now = Date()
        let live = envelope.data.map { $0.live(macOffline: Freshness.macIsStale($0, now: now)) }
        guard let track = live?.music, track.isLive, let title = track.title else {
            return .result(dialog: "Nothing is playing right now.")
        }
        let line = [title, track.artist].compactMap { $0 }.joined(separator: " — ")
        let verb = track.state == .paused ? "Paused" : "Playing"
        let message = "\(verb) on \(track.source.label): \(line)"
        return .result(dialog: "\(message)")
    }
}

struct LyjwpageShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ReportTelemetryIntent(),
            phrases: [
                "Report telemetry with \(.applicationName)",
                "Sync my rings with \(.applicationName)",
            ],
            shortTitle: "Report Telemetry",
            systemImageName: "arrow.up.circle"
        )
        AppShortcut(
            intent: NowListeningIntent(),
            phrases: [
                "What's playing on \(.applicationName)",
            ],
            shortTitle: "Now Playing",
            systemImageName: "music.note"
        )
    }
}

extension TelemetryHub.Outcome {
    var summary: String {
        switch self {
        case let .pushed(count): count == 1 ? "Reported 1 module." : "Reported \(count) modules."
        case .unchanged: "Nothing changed since the last report."
        case let .skipped(reason): reason
        case .coalesced: "A report just went out."
        case let .failed(reason): "Report failed: \(reason)"
        }
    }
}
