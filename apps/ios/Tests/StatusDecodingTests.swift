import Foundation
import Testing
// SwiftPM（Package.swift）里这些是单独的模块；Xcode 的测试目标把源码直接编进来，没有这个模块
#if canImport(LyjwpageCore)
@testable import LyjwpageCore
#endif

// dev-fixtures 直接读仓库那份而不是拷贝：契约一变，站点和 App 两边一起红
@Suite struct StatusDecodingTests {
    @Test func productionSnapshotsDecode() throws {
        try expectData(Status.desktop, "desktop")
        try expectData(Status.timezone, "timezone")
        try expectData(Status.activity, "activity")
        try expectData(Status.workouts, "workouts")
        try expectData(Status.server, "server")
        try expectData(Status.charger, "charger")
        try expectData(Status.powerBank, "powerbank")
        try expectData(Status.listening, "listening")
        try expectData(Status.nowListening, "listening-now")
        try expectData(Status.coding, "coding")
        try expectData(Status.codingNow, "coding-now")
        try expectData(Status.codingYear, "coding-year")
        try expectData(Status.limits, "limits")
        try expectData(Status.agentStatus, "agent-status")
        try expectData(Status.watching, "watching")
        try expectData(Status.nowWatching, "watching-now")
        try expectData(Status.playing, "playing")
        try expectData(Status.playingNow, "playing-now")
        try expectData(Status.trophies, "trophies")
        try expectData(Status.githubRepo, "github-repo")
        try expectData(Status.vercelDeployments, "vercel-deployments")
        try expectData(Status.cloudflareWorkers, "cloudflare-workers")
        try expectData(Status.sentry, "sentry")
        try expectData(Status.reporters, "reporters")
        try expectData(Status.pulse, "pulse")

        let version = try StatusClient.decoder.decode(AppVersionPayload.self, from: fixture("version"))
        #expect(version.commit?.count == 40)
    }

    @Test func lagViewsCarryUpdatedAt() throws {
        let envelope = try decode(Status.activity, fixture("activity"))
        #expect(envelope.updatedAt != nil)
        #expect(envelope.servedAt != nil)
    }

    @Test func pulseExpandsEveryLane() throws {
        let pulse = try #require(try decode(Status.pulse, fixture("pulse")).data)
        #expect(pulse.lanes.coding != nil)
        #expect(pulse.lanes.tokens != nil)
        #expect(pulse.lanes.listening != nil)
        #expect(pulse.lanes.watching != nil)
        #expect(pulse.lanes.gaming != nil)
        #expect(pulse.lanes.charging != nil)
        #expect(pulse.lanes.activity != nil)
        #expect(pulse.window.to - pulse.window.from == 86_400_000)
    }

    @Test(arguments: [
        "listening-now-yoasobi", "charger-macbook-iphone", "charger-idle", "powerbank-charging",
        "watching-now", "watching-now-paused", "playing-now-pragmata", "desktop-claude-code",
        "desktop-ghostty", "coding-multi-source", "coding-source-error", "coding-now-active",
        "coding-year", "limits-steady", "agent-status-degraded", "agent-status-boundary",
        "activity-afternoon", "workouts", "server-traffic", "sentry-steady", "reporters-steady",
        "pulse-busy-day", "pulse-empty", "pulse-zero-lanes", "pulse-tokens-idle",
    ])
    func devFixtureDecodes(name: String) throws {
        let data = try devFixture(name)
        switch name {
        case let n where n.hasPrefix("listening-now"): try expectData(Status.nowListening, data)
        case let n where n.hasPrefix("charger"): try expectData(Status.charger, data)
        case let n where n.hasPrefix("powerbank"): try expectData(Status.powerBank, data)
        case let n where n.hasPrefix("watching-now"): try expectData(Status.nowWatching, data)
        case let n where n.hasPrefix("playing-now"): try expectData(Status.playingNow, data)
        case let n where n.hasPrefix("desktop"): try expectData(Status.desktop, data)
        case let n where n.hasPrefix("coding-now"): try expectData(Status.codingNow, data)
        case "coding-year": try expectData(Status.codingYear, data)
        case let n where n.hasPrefix("coding"): try expectData(Status.coding, data)
        case let n where n.hasPrefix("limits"): try expectData(Status.limits, data)
        case let n where n.hasPrefix("agent-status"): try expectData(Status.agentStatus, data)
        case let n where n.hasPrefix("activity"): try expectData(Status.activity, data)
        case "workouts": try expectData(Status.workouts, data)
        case let n where n.hasPrefix("server"): try expectData(Status.server, data)
        case let n where n.hasPrefix("sentry"): try expectData(Status.sentry, data)
        case let n where n.hasPrefix("reporters"): try expectData(Status.reporters, data)
        case let n where n.hasPrefix("pulse"): try expectData(Status.pulse, data)
        default: Issue.record("没登记 \(name) 用哪个端点解码")
        }
    }

    @Test func okFalseEnvelopeKeepsError() throws {
        let envelope = try decode(Status.agentStatus, devFixture("agent-status-empty"))
        #expect(envelope.data == nil)
        #expect(envelope.error == "Status unavailable")
    }

    @Test func nowListeningFixtureIsLive() throws {
        let payload = try #require(try decode(Status.nowListening, devFixture("listening-now-yoasobi")).data)
        let music = try #require(payload.music)
        #expect(music.isLive)
        #expect(music.source == .appleMusic)
    }

    @Test func liveEventsDecode() throws {
        let online = try StatusClient.decoder.decode(LiveEvent.self, from: Data(#"{"type":"online","payload":{"online":3}}"#.utf8))
        guard case .online(3) = online else { Issue.record("online 解错了：\(online)"); return }

        let presence = try StatusClient.decoder.decode(LiveEvent.self, from: Data(#"{"type":"presence","payload":null}"#.utf8))
        guard case .presence = presence else { Issue.record("presence 解错了"); return }

        let future = try StatusClient.decoder.decode(LiveEvent.self, from: Data(#"{"type":"quest-now","payload":{"x":1}}"#.utf8))
        guard case .unknown("quest-now") = future else { Issue.record("没登记的事件应落到 unknown"); return }

        let desktop = try JSONSerialization.jsonObject(with: fixture("desktop")) as? [String: Any]
        let message = try JSONSerialization.data(withJSONObject: ["type": "desktop", "payload": desktop?["data"] as Any])
        guard case let .desktop(payload) = try StatusClient.decoder.decode(LiveEvent.self, from: message) else {
            Issue.record("desktop 事件没解出来"); return
        }
        #expect(payload.desktop?.applicationName.isEmpty == false)
    }

    @Test func unknownEnumValueDoesNotFailPayload() throws {
        let json = #"{"source":"vision-pro","state":"buffering","title":"x","artist":null,"album":null,"trackId":null,"artworkUrl":null,"positionMs":0,"durationMs":0,"repeatOne":false,"observedAt":1}"#
        let music = try StatusClient.decoder.decode(LocalNowPlaying.self, from: Data(json.utf8))
        #expect(music.source == .unknown)
        #expect(music.state == .unknown)
    }

    @Test func trackPositionExtrapolates() {
        let track = LocalNowPlaying(
            source: .appleMusic, state: .playing, title: "t", artist: nil, album: nil, trackId: nil,
            artworkUrl: nil, positionMs: 1_000, durationMs: 10_000, repeatOne: false, observedAt: 50_000
        )
        #expect(track.positionMs(at: Date(epochMilliseconds: 52_000)) == 3_000)
        #expect(track.positionMs(at: Date(epochMilliseconds: 90_000)) == 10_000)

        let looping = LocalNowPlaying(
            source: .homepod, state: .playing, title: "t", artist: nil, album: nil, trackId: nil,
            artworkUrl: nil, positionMs: 9_000, durationMs: 10_000, repeatOne: true, observedAt: 0
        )
        #expect(looping.positionMs(at: Date(epochMilliseconds: 3_000)) == 2_000)
    }

    @Test func staleRulesMatchSite() {
        let now = Date(epochMilliseconds: 1_000_000)
        #expect(!Freshness.isStale(now: now, at: nil, windowMs: 10))
        #expect(Freshness.isStale(now: now, at: 0, windowMs: 10))
        #expect(Freshness.isStale(now: now, at: 999_000, windowMs: 999))
        #expect(!Freshness.isStale(now: now, at: 999_000, windowMs: 1_000))
        #expect(Freshness.isStale(now: now, at: 999_999, windowMs: 1_000, declaredOffline: true))
    }

    @Test func appleArtworkTemplateExpands() {
        let url = AssetURL.appleArtwork("https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/{w}x{h}bb.jpg", points: 100)
        #expect(url?.absoluteString == "https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/300x300bb.webp")
        let formatted = AssetURL.appleArtwork("https://x/{w}x{h}{c}.{f}", points: 10, scale: 2)
        #expect(formatted?.absoluteString == "https://x/20x20sr.webp")
    }

    @Test func isoTimestampsParseWithAndWithoutFraction() {
        #expect(ISO8601Parsing.date("2026-09-30T08:23:40.634Z")?.epochMilliseconds == 1_790_756_620_634)
        #expect(ISO8601Parsing.date("2026-09-30T08:23:40Z")?.epochMilliseconds == 1_790_756_620_000)
        #expect(ISO8601Parsing.date("not a date") == nil)
    }

    @Test func socketFollowsApiHost() {
        #expect(SiteHosts.socketURL(for: SiteHosts.production).absoluteString == "wss://api.homepage.lyjw.llc/ws")
        #expect(SiteHosts.socketURL(for: URL(string: "http://localhost:8788")!).absoluteString == "ws://localhost:8788/ws")
    }

    @Test func sameOriginImagesResolveToSite() {
        #expect(AssetURL.resolve("/img/abc.png")?.absoluteString == "https://lyjw.me/img/abc.png")
        #expect(AssetURL.resolve("https://cdn.example/a.png")?.absoluteString == "https://cdn.example/a.png")
        #expect(AssetURL.resolve(nil) == nil)
    }

    @Test func malformedPulseLaneIsDroppedAlone() throws {
        let json = #"""
        {"generatedAt":1,"window":{"from":0,"to":86400000},"lanes":{
          "coding":{"kind":"coding","segments":{"startSec":[0,1],"endSec":[1],"value":[1,2]},"assessments":{"startSec":[],"endSec":[],"intensity":[],"confidence":[],"mode":[]},"summary":{"humanSeconds":0,"agentSeconds":0,"bothSeconds":0}},
          "charging":{"kind":"power","segments":{"startSec":[0],"endSec":[60],"watts":[20]},"currentPowerW":null,"summary":{"peakW":20,"energyWh":0.3}}
        }}
        """#
        let pulse = try StatusClient.decoder.decode(PulsePayload.self, from: Data(json.utf8))
        #expect(pulse.lanes.coding == nil)
        #expect(pulse.lanes.charging?.segments.first?.value == 20)
    }

    private func decode<P>(_ endpoint: StatusEndpoint<P>, _ data: Data) throws -> StatusEnvelope<P> {
        try StatusClient.decoder.decode(StatusEnvelope<P>.self, from: data)
    }

    private func expectData<P>(_ endpoint: StatusEndpoint<P>, _ name: String) throws {
        try expectData(endpoint, fixture(name))
    }

    private func expectData<P>(_ endpoint: StatusEndpoint<P>, _ data: Data) throws {
        let envelope = try decode(endpoint, data)
        #expect(envelope.data != nil, "\(endpoint.path) 回了 ok:false：\(envelope.error ?? "")")
    }

    private static let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()

    private func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: Self.here.appending(path: "Fixtures/\(name).json"))
    }

    // 站点开发夹具里的 `"$now-60000"` / `"$today"` 令牌按站点脚本的规则换成此刻。源：scripts/dev-override.mjs#NOW_TOKEN
    private func devFixture(_ name: String) throws -> Data {
        let url = Self.here.appending(path: "../../../workers/api/dev-fixtures/\(name).json").standardizedFileURL
        var text = try String(contentsOf: url, encoding: .utf8)
        let now = Date().epochMilliseconds.rounded()
        text = text.replacing(/"\$now(?<offset>[+-]\d+)?"/) { match in
            let offset = match.output.offset.flatMap { Double($0) } ?? 0
            return String(Int64(now + offset))
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        text = text.replacing(/"\$today(?<offset>[+-]\d+)?"/) { match in
            let days = match.output.offset.flatMap { Int($0) } ?? 0
            let day = Date().addingTimeInterval(Double(days) * 86_400)
            return "\"\(formatter.string(from: day))\""
        }
        // 注入脚本也收「直接是 data」的夹具，这里补成信封
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8))
        if let dictionary = object as? [String: Any], dictionary["ok"] == nil {
            return try JSONSerialization.data(withJSONObject: ["ok": true, "data": dictionary])
        }
        return Data(text.utf8)
    }
}
