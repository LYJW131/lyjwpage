import AppIntents
import Foundation

/**
 「立刻上报」：Siri、快捷指令、操作按钮都能触发，不用打开 App。

 HealthKit 的后台投递按小时节流，想让站点上的圈立刻跟上只能手动报一次；以前只能打开 App 点按钮，
 现在在后台就能跑。`allowedExecutionTargets` 限定只在主 App 进程里执行 —— 上报器、HealthKit
 授权、钥匙串里的凭据都只在这个进程里。
 */
struct ReportTelemetryIntent: AppIntent {
    static let title: LocalizedStringResource = "Report Telemetry"
    static let description = IntentDescription("Sends this iPhone's activity rings and recent workouts to lyjw.me right now.")
    static let supportedModes: IntentModes = .background
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = await TelemetryHub.shared.report(force: true)
        return .result(dialog: "\(outcome.summary)")
    }
}

/// 「站点上此刻在放什么」：读的是站点公开的那一份，和访客看到的一致
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
