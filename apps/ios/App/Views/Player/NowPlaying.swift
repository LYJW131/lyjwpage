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

struct NowPlayingView: View {
    @Environment(LiveStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var lyrics: [LyricLine] = []
    @State private var showsLyrics = false
    @State private var startingPlayback = false
    @State private var playbackError: String?

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let live = store.liveListening(now: context.date)
                let item = store.listeningItem(for: live)
                let artwork = AssetURL.appleArtwork(item?.artwork ?? live?.music?.artworkUrl, points: 400)
                ZStack {
                    backdrop(artwork)
                    VStack(spacing: 0) {
                        header(live)
                        if let track = live?.music {
                            ScrollView {
                                if geometry.size.width > geometry.size.height && !typeSize.isAccessibilitySize {
                                    HStack(spacing: 36) {
                                        cover(artwork, size: min(geometry.size.height - 110, 300))
                                        details(track, live: live, now: context.date)
                                    }
                                    .padding(.horizontal, 36)
                                    .padding(.vertical, 16)
                                } else {
                                    VStack(spacing: 28) {
                                        if showsLyrics {
                                            LyricsView(lines: lyrics, positionMs: track.positionMs(at: context.date))
                                                .frame(height: max(220, geometry.size.height * 0.4))
                                        } else {
                                            cover(artwork, size: min(geometry.size.width - 64, geometry.size.height * 0.42, 340))
                                                .padding(.top, 18)
                                        }
                                        details(track, live: live, now: context.date)
                                    }
                                    .padding(.horizontal, 32)
                                    .padding(.bottom, 30)
                                }
                            }
                            .scrollIndicators(.hidden)
                        } else {
                            ContentUnavailableView("Nothing Playing", systemImage: "music.note")
                        }
                    }
                }
                .foregroundStyle(.white)
                .task(id: live?.hasLyrics == true ? live?.songId : nil) {
                    lyrics = []
                    guard live?.hasLyrics == true, let songID = live?.songId else { return }
                    let result = try? await StatusClient.shared.lyrics(songID: songID)
                    guard !Task.isCancelled else { return }
                    lyrics = result?.lines ?? []
                }
            }
        }
        .preferredColorScheme(.dark)
        .alert("Unable to Listen Along", isPresented: Binding(
            get: { playbackError != nil }, set: { if !$0 { playbackError = nil } }
        )) {
            Button("OK", role: .cancel) { playbackError = nil }
        } message: {
            Text(playbackError ?? "")
        }
    }

    private func header(_ live: NowListeningPayload?) -> some View {
        HStack {
            Button("Close", systemImage: "chevron.down") { dismiss() }
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
            Spacer()
            VStack(spacing: 3) {
                Text("NOW PLAYING").font(.caption2.weight(.semibold)).tracking(2)
                Text(live?.music?.source.label ?? "lyjwpage").font(.caption).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Menu {
                if let link = live?.link.flatMap(URL.init(string:)) {
                    Link("Open in Apple Music", destination: link)
                    ShareLink(item: link)
                }
            } label: {
                Image(systemName: "ellipsis").frame(width: 44, height: 44)
            }
            .accessibilityLabel("Song Options")
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
    }

    private func cover(_ url: URL?, size: CGFloat) -> some View {
        RemoteImage(url: url)
            .frame(width: max(120, size), height: max(120, size))
            .clipShape(.rect(cornerRadius: 10))
            .shadow(color: .black.opacity(0.35), radius: 24, y: 14)
            .accessibilityIdentifier("player.artwork")
    }

    private func details(_ track: LocalNowPlaying, live: NowListeningPayload?, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 6) {
                Text(track.title ?? "Unknown Track").font(.title2.weight(.bold)).lineLimit(2)
                Text(track.artist ?? "").font(.title3).foregroundStyle(.white.opacity(0.7)).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 8) {
                let position = track.positionMs(at: now)
                ProgressView(value: min(position, max(track.durationMs, 1)), total: max(track.durationMs, 1))
                    .tint(.white.opacity(0.8))
                HStack {
                    Text(Format.clock(milliseconds: position))
                    Spacer()
                    Text("−" + Format.clock(milliseconds: max(0, track.durationMs - position)))
                }
                .font(.caption).monospacedDigit().foregroundStyle(.white.opacity(0.6))
            }
            Button {
                guard let live else { return }
                startingPlayback = true
                Task {
                    defer { startingPlayback = false }
                    do { try await SystemMusic.listenAlong(to: live) }
                    catch { playbackError = error.localizedDescription }
                }
            } label: {
                HStack(spacing: 12) {
                    if startingPlayback { ProgressView() }
                    else { Image(systemName: "play.fill").font(.title2) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Listen Along").font(.headline)
                        Text("Play in Apple Music").font(.caption).foregroundStyle(.white.opacity(0.65))
                    }
                    Spacer()
                    Image(systemName: "arrow.up.forward.app")
                }
                .padding(18)
                .background(.white.opacity(0.12), in: .rect(cornerRadius: 18))
            }
            .buttonStyle(.plain)
            .disabled(startingPlayback || live?.songId == nil)
            .accessibilityLabel("Listen Along in Apple Music")
            HStack {
                Button {
                    withAnimation(.smooth) { showsLyrics.toggle() }
                } label: {
                    Image(systemName: "quote.bubble")
                        .font(.title3)
                        .frame(width: 48, height: 44)
                        .background(showsLyrics ? .white.opacity(0.2) : .clear, in: .rect(cornerRadius: 12))
                }
                .accessibilityLabel("Lyrics")
                .accessibilityValue(showsLyrics ? "Shown" : "Hidden")
                .disabled(lyrics.isEmpty)
                // 整页前景固定为白色，系统不会替禁用的按钮变暗；没歌词时要看得出点不了
                .opacity(lyrics.isEmpty ? 0.35 : 1)
                Spacer()
                Label(track.state == .paused ? "Paused on \(track.source.label)" : "Playing on \(track.source.label)",
                      systemImage: track.source == .homepod ? "homepod.fill" : "laptopcomputer")
                    .font(.caption).foregroundStyle(.white.opacity(0.65))
                Spacer()
                if let link = live?.link.flatMap(URL.init(string:)) {
                    ShareLink(item: link) {
                        Image(systemName: "square.and.arrow.up").font(.title3).frame(width: 48, height: 44)
                    }
                    .accessibilityLabel("Share Song")
                }
            }
        }
    }

    private func backdrop(_ url: URL?) -> some View {
        GeometryReader { geometry in
            RemoteImage(url: url)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
                .blur(radius: 70, opaque: true)
                .overlay(Color.black.opacity(0.55))
                .overlay(LinearGradient(colors: [.clear, .black.opacity(0.5)], startPoint: .top, endPoint: .bottom))
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct LyricsView: View {
    let lines: [LyricLine]
    let positionMs: Double

    var body: some View {
        let current = lines.lastIndex { $0.startMs <= positionMs && positionMs < $0.endMs }
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        Text(line.text.isEmpty ? "♪" : line.text)
                            .font(.title.weight(.bold))
                            .foregroundStyle(.white.opacity(index == current ? 1 : 0.35))
                            .id(index)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 30)
            }
            .scrollIndicators(.hidden)
            .onChange(of: current, initial: true) { _, index in
                guard let index else { return }
                withAnimation(.smooth) { proxy.scrollTo(index, anchor: .center) }
            }
        }
    }
}
