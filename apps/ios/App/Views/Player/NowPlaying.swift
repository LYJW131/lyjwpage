import SwiftUI

/// Tab 栏底部附件里的迷你播放器。Tab 栏收起时附件并进同一行，这时只留封面和歌名
struct MiniPlayer: View {
    @Environment(LiveStore.self) private var store
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    var onOpen: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            if let track = store.liveTrack(now: context.date) {
                let item = store.listeningItem(for: store.liveListening(now: context.date))
                Button(action: onOpen) {
                    HStack(spacing: 10) {
                        RemoteImage(url: AssetURL.appleArtwork(item?.artwork ?? track.artworkUrl, points: 32))
                            .frame(width: 32, height: 32)
                            .clipShape(.rect(cornerRadius: 6, style: .continuous))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(track.title ?? "")
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            if placement != .inline {
                                Text(track.artist ?? "")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: track.state == .playing ? "waveform" : "pause.fill")
                            .symbolEffect(.variableColor.iterative.reversing, options: .repeating, isActive: track.state == .playing)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 14)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Now playing: \(track.title ?? ""), \(track.artist ?? "")")
            }
        }
    }
}

/**
 完整的正在播放：大封面、进度、来源设备，有同步歌词就按进度高亮当前那一句。

 背景用专辑配色，和站点的媒体卡一样：颜色只服务于内容。工具栏按钮是系统的液态玻璃；
 「在 Apple Music 打开」钉在右上角（`topBarPinnedTrailing`），窗口变窄也不会被挤进溢出菜单。
 */
struct NowPlayingView: View {
    @Environment(LiveStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var lyrics: [LyricLine] = []

    var body: some View {
        let live = store.liveListening(now: .now)
        let item = store.listeningItem(for: live)
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                content(now: context.date, item: item)
            }
            .background { paletteBackground(item) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .close) { dismiss() }
                }
                if let link = live?.link.flatMap(URL.init(string:)) {
                    ToolbarItem(placement: .topBarPinnedTrailing) {
                        Link(destination: link) {
                            Label("Open in Apple Music", systemImage: "arrow.up.forward.app")
                        }
                    }
                }
            }
        }
        .task(id: lyricsSongID(live)) {
            await loadLyrics(songID: lyricsSongID(live))
        }
    }

    private func content(now: Date, item: ListeningItem?) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                if let track = store.liveListening(now: now)?.music {
                    RemoteImage(url: AssetURL.appleArtwork(item?.artwork ?? track.artworkUrl, points: 360))
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 20, style: .continuous))
                        .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
                        .padding(.horizontal, 24)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(track.title ?? "").font(.title2.weight(.bold))
                        Text(track.artist ?? "").font(.title3).foregroundStyle(.secondary)
                        if let album = track.album {
                            Text(album).font(.subheadline).foregroundStyle(.tertiary)
                        }
                        Label(
                            track.state == .paused ? "Paused on \(track.source.label)" : "Playing on \(track.source.label)",
                            systemImage: track.source == .homepod ? "homepod.fill" : "laptopcomputer"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)

                    PlaybackProgress(track: track)
                        .padding(.horizontal, 24)

                    if !lyrics.isEmpty {
                        LyricsView(lines: lyrics, positionMs: track.positionMs(at: now))
                            .padding(.horizontal, 24)
                    }
                } else {
                    ContentUnavailableView(
                        "Nothing Playing",
                        systemImage: "music.note",
                        description: Text("Music played on the Mac or HomePod shows up here.")
                    )
                    .padding(.top, 80)
                }
            }
            .padding(.bottom, 32)
        }
    }

    private func lyricsSongID(_ live: NowListeningPayload?) -> String? {
        live?.hasLyrics == true ? live?.songId : nil
    }

    @ViewBuilder
    private func paletteBackground(_ item: ListeningItem?) -> some View {
        if let hex = item?.palette.first, let color = Color(hex: hex) {
            LinearGradient(colors: [color.opacity(0.55), Color(uiColor: .systemBackground)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        } else {
            Color(uiColor: .systemBackground).ignoresSafeArea()
        }
    }

    private func loadLyrics(songID: String?) async {
        guard let songID else {
            lyrics = []
            return
        }
        lyrics = (try? await StatusClient.shared.lyrics(songID: songID).lines) ?? []
    }
}

/// 行级同步歌词：当前一句高亮、自动滚到中间
private struct LyricsView: View {
    let lines: [LyricLine]
    let positionMs: Double

    var body: some View {
        let current = lines.lastIndex { $0.startMs <= positionMs }
        ScrollViewReader { proxy in
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    Text(line.text.isEmpty ? "♪" : line.text)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(index == current ? Color.primary : Color.secondary.opacity(0.5))
                        .animation(.easeOut(duration: 0.25), value: current)
                        .id(index)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .onChange(of: current) { _, index in
                guard let index else { return }
                withAnimation(.smooth) { proxy.scrollTo(index, anchor: .center) }
            }
        }
    }
}
