import Foundation

/// 站点新增取值时不至于让整份载荷解码失败的字符串枚举
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

/// Mac 与 HomePod 共用的正在播放。`positionMs` 是 `observedAt` 那一刻的进度
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

    /// 对着站点的 `src/lib/track-position.ts#trackPositionMs`：在放就按经过的时间往前推
    func positionMs(at now: Date) -> Double {
        let drift = state == .playing ? max(0, now.epochMilliseconds - observedAt) : 0
        let elapsed = positionMs + drift
        guard durationMs > 0 else { return elapsed }
        return repeatOne ? elapsed.truncatingRemainder(dividingBy: durationMs) : min(durationMs, elapsed)
    }

    /// 对着 `src/lib/home-layout.ts#liveTrack`：有歌名且没停才算「正在听」
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
    /// 专辑 / 歌单 id，与 `ListeningItem.id` 同一套
    let id: String?
    let link: String?
    /// Apple Music 曲库 id，取歌词用
    let songId: String?
    let upcomingSongIds: [String]
    let hasLyrics: Bool
    /// 暂停宽限期，到点应重取一次
    let expiresInMs: Double?
    let alternate: NowListeningAlternate?
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double

    /**
     对着站点的 `src/lib/freshness.ts#liveNowListening`：Mac 掉线时它报的那首已不可信，
     换成接班的那一路（HomePod），没有就当空闲。
     */
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
    /// Apple 的封面模板，带 `{w}x{h}` 占位，用 `AssetURL.appleArtwork` 展开
    let artwork: String?
    let link: String?
    /// `#rrggbb`：背景色 + 四档文字色
    let palette: [String]
    let durationMs: Double?
}

struct ListeningPayload: Decodable, Sendable, Equatable {
    let items: [ListeningItem]
    /// 代际标记，不是新鲜度信号
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
    /// 0–100
    let progress: Double
    /// `/img/<objectKey>` 同源路径
    let poster: String?
    let backdrop: String?
    let type: WatchingType
    let year: Int?
    let link: String?
    /// ISO 8601
    let playedAt: String?
}

struct WatchingVideo: Decodable, Sendable, Equatable {
    let codec: String?
    let width: Int?
    let height: Int?
    /// sdr / hdr / hdr10 / hdr10plus / dolby-vision / hlg
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
    /// bit/s
    let bitrate: Double?
    let video: WatchingVideo?
    let audio: WatchingAudio?
}

struct ResolvedNowPlaying: Decodable, Sendable, Equatable {
    let itemId: String
    let paused: Bool
    /// 0–100，已按站点出响应的时刻推算过
    let progress: Double?
    let client: String?
    let deviceName: String?
    /// directplay / directstream / transcode
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
