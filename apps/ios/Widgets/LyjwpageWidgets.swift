import SwiftUI
import WidgetKit

/**
 桌面与锁屏小组件。各自从站点公开的状态 API 取数，不和 App 共享存储：App 平时不在运行，
 小组件要的恰好就是「访客此刻看到的那一份」，直接读站点最省事也最准。

 刷新节奏由系统定（小组件有每日预算），这里给的只是「下次最好什么时候来」：正在听那张
 按歌的剩余时长给，圆环按上报器的小时节奏给。
 */
@main
struct LyjwpageWidgets: WidgetBundle {
    var body: some Widget {
        NowListeningWidget()
        ActivityRingsWidget()
    }
}

// MARK: 正在听

struct ListeningEntry: TimelineEntry {
    let date: Date
    let title: String?
    let artist: String?
    let source: MusicSource?
    let playing: Bool
    /// 小组件里不能用 AsyncImage，封面要在时间线里先下载好
    let artwork: Data?
    let tint: String?
}

struct ListeningProvider: TimelineProvider {
    func placeholder(in context: Context) -> ListeningEntry {
        ListeningEntry(date: .now, title: "Song Title", artist: "Artist", source: .appleMusic, playing: true, artwork: nil, tint: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (ListeningEntry) -> Void) {
        Task { completion(await Self.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<ListeningEntry>) -> Void) {
        Task {
            let entry = await Self.load()
            // 在放就在这首大概放完时再来；没在放就半小时后看看
            let next = entry.playing ? Date.now.addingTimeInterval(5 * 60) : Date.now.addingTimeInterval(30 * 60)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    static func load() async -> ListeningEntry {
        let client = StatusClient.shared
        async let nowListening = try? client.fetch(Status.nowListening).data
        async let listening = try? client.fetch(Status.listening).data
        let now = Date.now
        let live = await nowListening.map { $0.live(macOffline: Freshness.macIsStale($0, now: now)) }
        let items = await listening?.items ?? []

        if let track = live?.music, track.isLive {
            let item = items.first { $0.id == live?.id }
            let artwork = await download(AssetURL.appleArtwork(item?.artwork ?? track.artworkUrl, points: 160, scale: 2))
            return ListeningEntry(
                date: now, title: track.title, artist: track.artist, source: track.source,
                playing: track.state == .playing, artwork: artwork, tint: item?.palette.first
            )
        }
        guard let last = items.first else {
            return ListeningEntry(date: now, title: nil, artist: nil, source: nil, playing: false, artwork: nil, tint: nil)
        }
        let artwork = await download(AssetURL.appleArtwork(last.artwork, points: 160, scale: 2))
        return ListeningEntry(
            date: now, title: last.title, artist: last.artist, source: nil,
            playing: false, artwork: artwork, tint: last.palette.first
        )
    }

    private static func download(_ url: URL?) async -> Data? {
        guard let url else { return nil }
        return try? await StatusClient.shared.session.data(from: url).0
    }
}

struct NowListeningWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NowListening", provider: ListeningProvider()) { entry in
            ListeningWidgetView(entry: entry)
                .environment(\.locale, Format.locale)
        }
        .configurationDisplayName("Listening")
        .description("What's playing on the Mac or HomePod, or the last album played.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct ListeningWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListeningEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Label(entry.playing ? "Now Playing" : "Last Played", systemImage: "music.note")
                        .font(.caption2.weight(.semibold))
                    Text(entry.title ?? "Nothing played").font(.headline).lineLimit(1)
                    Text(entry.artist ?? "").font(.caption).lineLimit(1)
                }
            case .systemMedium:
                HStack(spacing: 14) {
                    artwork.frame(width: 110, height: 110)
                    details
                    Spacer(minLength: 0)
                }
            default:
                VStack(alignment: .leading, spacing: 8) {
                    artwork.frame(width: 64, height: 64)
                    Spacer(minLength: 0)
                    details
                }
            }
        }
        .containerBackground(for: .widget) {
            if let hex = entry.tint, let color = Color(widgetHex: hex) {
                LinearGradient(colors: [color.opacity(0.45), color.opacity(0.15)], startPoint: .top, endPoint: .bottom)
            } else {
                Rectangle().fill(.fill.tertiary)
            }
        }
    }

    @ViewBuilder
    private var artwork: some View {
        if let data = entry.artwork, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                // 着色 / 透明主屏上封面按系统规则去饱和，不整块被染成一个颜色
                .widgetAccentedRenderingMode(.desaturated)
                .aspectRatio(1, contentMode: .fill)
                .clipShape(.rect(cornerRadius: 10, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.quaternary)
                .overlay { Image(systemName: "music.note").foregroundStyle(.secondary) }
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if entry.playing {
                    Circle().fill(Color.live).frame(width: 6, height: 6)
                }
                Text(entry.playing ? "On \(entry.source?.label ?? "Mac")" : "Last played")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(entry.title ?? "Nothing played yet")
                .font(.headline)
                .lineLimit(2)
                .widgetAccentable()
            Text(entry.artist ?? "")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

// MARK: 活动圆环

struct RingsEntry: TimelineEntry {
    let date: Date
    let activity: ActivityPayload?
    let stale: Bool
}

struct RingsProvider: TimelineProvider {
    func placeholder(in context: Context) -> RingsEntry {
        RingsEntry(date: .now, activity: nil, stale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (RingsEntry) -> Void) {
        Task { completion(await Self.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<RingsEntry>) -> Void) {
        Task {
            let entry = await Self.load()
            // 圆环由 iPhone 自己按小时报上去，比这更勤地来取也只会拿到同一份
            completion(Timeline(entries: [entry], policy: .after(Date.now.addingTimeInterval(60 * 60))))
        }
    }

    static func load() async -> RingsEntry {
        let activity = try? await StatusClient.shared.fetch(Status.activity).data
        let now = Date.now
        let stale = activity.map { Freshness.isStale(now: now, at: $0.pushedAt, windowMs: Freshness.activityStaleMs) } ?? true
        return RingsEntry(date: now, activity: activity, stale: stale)
    }
}

struct ActivityRingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ActivityRings", provider: RingsProvider()) { entry in
            RingsWidgetView(entry: entry)
                .environment(\.locale, Format.locale)
        }
        .configurationDisplayName("Activity Rings")
        .description("Move, exercise and stand, as lyjw.me shows them.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct RingsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RingsEntry

    var body: some View {
        Group {
            if let activity = entry.activity, !entry.stale {
                switch family {
                case .accessoryCircular:
                    rings(activity, lineWidth: 5, spacing: 1)
                case .accessoryRectangular:
                    HStack {
                        rings(activity, lineWidth: 4, spacing: 1).frame(width: 44, height: 44)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("\(Format.integer(activity.moveKcal))/\(Format.integer(activity.moveGoalKcal)) kcal")
                            Text("\(Format.integer(activity.exerciseMinutes))/\(Format.integer(activity.exerciseGoalMinutes)) min")
                            Text("\(Format.integer(activity.standHours))/\(Format.integer(activity.standGoalHours)) hr")
                        }
                        .font(.caption2)
                        .monospacedDigit()
                    }
                default:
                    VStack(alignment: .leading, spacing: 8) {
                        rings(activity, lineWidth: 10, spacing: 2)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        HStack {
                            Text("\(Format.integer(activity.moveKcal)) kcal").foregroundStyle(Color.moveRing)
                            Spacer()
                            if let steps = activity.steps {
                                Text("\(Format.compact(steps)) steps").foregroundStyle(.secondary)
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                    }
                }
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "figure.walk.circle")
                        .font(.title2)
                    Text("Unavailable").font(.caption)
                }
                .foregroundStyle(.secondary)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private func rings(_ activity: ActivityPayload, lineWidth: CGFloat, spacing: CGFloat) -> some View {
        ActivityRings(
            move: activity.moveGoalKcal > 0 ? activity.moveKcal / activity.moveGoalKcal : 0,
            exercise: activity.exerciseGoalMinutes > 0 ? activity.exerciseMinutes / activity.exerciseGoalMinutes : 0,
            stand: activity.standGoalHours > 0 ? activity.standHours / activity.standGoalHours : 0,
            lineWidth: lineWidth,
            spacing: spacing
        )
        .widgetAccentable()
        .opacity(activity.currentAtSource ? 1 : 0.5)
    }
}

private extension Color {
    init?(widgetHex hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
