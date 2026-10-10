import Foundation

// 站点新增取值时不能让整份载荷解码失败。
protocol LenientStringEnum: RawRepresentable, Decodable, Sendable where RawValue == String {
    static var unknownCase: Self { get }
}

extension LenientStringEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }
}

enum PlaybackState: String, LenientStringEnum, Equatable {
    case playing, paused, stopped, unknown
    static let unknownCase = PlaybackState.unknown
}

enum MusicSource: String, LenientStringEnum, Equatable {
    case appleMusic = "apple-music"
    case homepod
    case unknown
    static let unknownCase = MusicSource.unknown

    var label: String {
        switch self {
        case .appleMusic: "Mac"
        case .homepod: "HomePod"
        case .unknown: "Elsewhere"
        }
    }
}

// positionMs 是 observedAt 那一刻的进度。
struct LocalNowPlaying: Decodable, Sendable, Equatable {
    let source: MusicSource
    let state: PlaybackState
    let title: String?
    let artist: String?
    let album: String?
    let trackId: String?
    let artworkUrl: String?
    let positionMs: Double
    let durationMs: Double
    let repeatOne: Bool
    let observedAt: Double

    // 须与站点 `src/lib/track-position.ts#trackPositionMs` 同一推算。
    func positionMs(at now: Date) -> Double {
        let drift = state == .playing ? max(0, now.epochMilliseconds - observedAt) : 0
        let elapsed = positionMs + drift
        guard durationMs > 0 else { return elapsed }
        return repeatOne ? elapsed.truncatingRemainder(dividingBy: durationMs) : min(durationMs, elapsed)
    }

    // 须与站点 `src/lib/home-layout.ts#liveTrack` 同一判断。
    var isLive: Bool { title?.isEmpty == false && state != .stopped }
}

struct NowListeningAlternate: Decodable, Sendable, Equatable {
    let music: LocalNowPlaying
    let id: String?
    let link: String?
    let songId: String?
    let upcomingSongIds: [String]
    let hasLyrics: Bool
}

struct NowListeningPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let music: LocalNowPlaying?
    let receivedAt: Double?
    let idle: Bool
    // 与 ListeningItem.id 同一套 id。
    let id: String?
    let link: String?
    let songId: String?
    let upcomingSongIds: [String]
    let hasLyrics: Bool
    // 暂停宽限期，到点应重取一次。
    let expiresInMs: Double?
    let alternate: NowListeningAlternate?
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double

    // Mac 掉线时它报的那首已不可信，换成 HomePod，没有就当空闲。须与站点 `src/lib/freshness.ts#liveNowListening` 一致。
    func live(macOffline: Bool) -> NowListeningPayload {
        guard macOffline, music?.source == .appleMusic else { return self }
        return NowListeningPayload(
            music: alternate?.music, receivedAt: receivedAt, idle: alternate == nil,
            id: alternate?.id, link: alternate?.link, songId: alternate?.songId,
            upcomingSongIds: alternate?.upcomingSongIds ?? [], hasLyrics: alternate?.hasLyrics ?? false,
            expiresInMs: nil, alternate: nil,
            lastSeenAt: lastSeenAt, declaredOffline: declaredOffline, heartbeatWindowMs: heartbeatWindowMs
        )
    }
}

struct ListeningItem: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let artist: String
    // 带 {w}x{h} 占位的模板，要先展开。与此刻 LocalNowPlaying.artworkUrl 同一字段。
    let artworkUrl: String?
    let link: String?
    // #rrggbb：背景色 + 四档文字色。
    let palette: [String]
    let durationMs: Double?
}

struct ListeningPayload: Decodable, Sendable, Equatable {
    let items: [ListeningItem]
    // 代际标记，不是新鲜度信号。
    let fetchedAt: Double
}

struct LyricLine: Decodable, Sendable, Equatable {
    let startMs: Double
    let endMs: Double
    let text: String
}

struct LyricsPayload: Decodable, Sendable, Equatable {
    let lines: [LyricLine]
    let songId: String?
    let error: String?
}

enum WatchingType: String, LenientStringEnum, Equatable {
    case episode = "Episode", movie = "Movie", series = "Series", other = "Other"
    static let unknownCase = WatchingType.other
}

struct WatchingItem: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let subtitle: String
    // 0–100
    let progress: Double
    let poster: String?
    let backdrop: String?
    let type: WatchingType
    let year: Int?
    let link: String?
    let playedAt: String?
}

struct WatchingVideo: Decodable, Sendable, Equatable {
    let codec: String?
    let width: Int?
    let height: Int?
    let range: String?
    let bitDepth: Int?
}

struct WatchingAudio: Decodable, Sendable, Equatable {
    let codec: String?
    let profile: String?
    let channels: Int?
    let layout: String?
    let language: String?
}

struct WatchingMedia: Decodable, Sendable, Equatable {
    let container: String?
    // bit/s
    let bitrate: Double?
    let video: WatchingVideo?
    let audio: WatchingAudio?
}

struct ResolvedNowPlaying: Decodable, Sendable, Equatable {
    let itemId: String
    let paused: Bool
    // 0–100，已推算到站点出响应的时刻。
    let progress: Double?
    let client: String?
    let deviceName: String?
    let playMethod: String?
    let media: WatchingMedia?
    let positionMs: Double?
    let durationMs: Double?
}

struct WatchingPayload: Decodable, Sendable, Equatable {
    let items: [WatchingItem]
}

struct NowWatchingPayload: Decodable, Sendable, Equatable {
    let nowPlaying: ResolvedNowPlaying?
    let current: WatchingItem?
}
