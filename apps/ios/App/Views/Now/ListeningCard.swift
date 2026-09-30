import SwiftUI

/**
 正在听 / 最近听，对应站点的 ListeningCard。

 主位放此刻在放的那一首（Mac 的 Apple Music 或 HomePod）；没在放就放最近听的第一张。
 下面几行是最近听，点开进 Apple Music。完整的正在播放（进度、歌词）在底部附件里点开。
 */
struct ListeningCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        let live = store.liveListening(now: now)
        let track = store.liveTrack(now: now)
        let item = store.listeningItem(for: live) ?? (track == nil ? store.listening?.items.first : nil)

        Card(
            title: "Listening",
            systemImage: "music.note",
            status: track == nil ? .idle : .live,
            tint: item?.palette.first.flatMap { Color(hex: $0) }
        ) {
            if let track {
                LiveTrackRow(track: track, item: item, now: now)
            } else if let item {
                RecentHero(item: item)
            } else if store.failure(.listening) != nil {
                CardPlaceholder(text: "Unavailable")
            } else {
                CardPlaceholder(text: "Nothing played yet")
            }

            let recent = (store.listening?.items ?? []).filter { $0.id != item?.id }.prefix(4)
            if !recent.isEmpty {
                Divider()
                VStack(spacing: 10) {
                    ForEach(Array(recent)) { entry in
                        RecentRow(item: entry)
                    }
                }
            }
        }
    }
}

private struct LiveTrackRow: View {
    let track: LocalNowPlaying
    let item: ListeningItem?
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            RemoteImage(url: AssetURL.appleArtwork(item?.artwork ?? track.artworkUrl, points: 88))
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 4)

            VStack(alignment: .leading, spacing: 4) {
                Text(track.title ?? "Unknown Track")
                    .font(.headline)
                    .lineLimit(2)
                Text(track.artist ?? "")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Image(systemName: track.source == .homepod ? "homepod.fill" : "laptopcomputer")
                    Text(track.state == .paused ? "Paused on \(track.source.label)" : "Playing on \(track.source.label)")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                PlaybackProgress(track: track)
                    .padding(.top, 4)
            }
        }
    }
}

/// 进度按上报那一刻的位置往前推，每秒走一格；暂停时停住
struct PlaybackProgress: View {
    let track: LocalNowPlaying

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let position = track.positionMs(at: context.date)
            VStack(spacing: 3) {
                ProgressView(value: min(position, max(track.durationMs, 1)), total: max(track.durationMs, 1))
                    .tint(.primary)
                HStack {
                    Text(Format.clock(milliseconds: position))
                    Spacer()
                    Text(Format.clock(milliseconds: track.durationMs))
                }
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct RecentHero: View {
    let item: ListeningItem

    var body: some View {
        HStack(spacing: 14) {
            RemoteImage(url: AssetURL.appleArtwork(item.artwork, points: 88))
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text("Last played")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(item.title).font(.headline).lineLimit(2)
                Text(item.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if let link = item.link.flatMap(URL.init(string:)) {
                    Link(destination: link) {
                        Label("Apple Music", systemImage: "arrow.up.forward.app")
                    }
                    .font(.caption.weight(.medium))
                    .padding(.top, 2)
                }
            }
        }
    }
}

private struct RecentRow: View {
    let item: ListeningItem

    var body: some View {
        let row = HStack(spacing: 12) {
            RemoteImage(url: AssetURL.appleArtwork(item.artwork, points: 44))
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(item.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)

        if let link = item.link.flatMap(URL.init(string:)) {
            Link(destination: link) { row }
                .buttonStyle(.plain)
        } else {
            row
        }
    }
}
