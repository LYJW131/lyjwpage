import SwiftUI

enum LibrarySection: String, CaseIterable, Identifiable {
    case music = "Music", watching = "Watching", workouts = "Workouts", games = "Games"

    var id: String { rawValue }
}

/**
 听过、看过、练过、玩过的：站点首页各卡的「最近」那一半，在手机上单独成页。

 行都是 `ScrollView` + `LazyVStack` 里的自定义行，左滑的操作靠 iOS 27 的 `swipeActionsContainer`
 —— 以前只有 `List` 里能用。
 */
struct LibraryView: View {
    @Environment(LiveStore.self) private var store
    @State private var section: LibrarySection = .music

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    switch section {
                    case .music: music
                    case .watching: watching
                    case .workouts: workouts
                    case .games: games
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .swipeActionsContainer()
            .pageBackground()
            .navigationTitle(section.rawValue)
            .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
            .safeAreaInset(edge: .top) {
                Picker("Section", selection: $section) {
                    ForEach(LibrarySection.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .refreshable { await store.refresh([.listening, .watching, .workouts, .playing, .trophies]) }
            .navigationDestination(for: WatchingItem.ID.self) { id in
                if let item = store.watching?.items.first(where: { $0.id == id }) {
                    WatchingDetailView(item: item)
                }
            }
        }
    }

    // MARK: 分区

    @ViewBuilder
    private var music: some View {
        let items = store.listening?.items ?? []
        if items.isEmpty {
            ContentUnavailableView("No Recent Music", systemImage: "music.note")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)], spacing: 18) {
                ForEach(items) { item in
                    AlbumTile(item: item)
                }
            }
        }
    }

    @ViewBuilder
    private var watching: some View {
        let items = store.watching?.items ?? []
        if items.isEmpty {
            ContentUnavailableView("Nothing Watched Yet", systemImage: "play.tv")
        } else {
            ForEach(items) { item in
                NavigationLink(value: item.id) {
                    WatchingRow(item: item)
                }
                .buttonStyle(.plain)
                .swipeActions {
                    if let link = item.link.flatMap(URL.init(string:)) {
                        Link(destination: link) {
                            Label("Emby", systemImage: "play.rectangle")
                        }
                        .tint(.green)
                    }
                    ShareLink(item: "\(item.title) — \(item.subtitle)") {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .tint(.blue)
                }
            }
        }
    }

    @ViewBuilder
    private var workouts: some View {
        let items = store.workouts?.items ?? []
        if items.isEmpty {
            ContentUnavailableView("No Workouts", systemImage: "figure.run")
        } else {
            ForEach(items) { workout in
                WorkoutTile(workout: workout)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
            }
        }
    }

    @ViewBuilder
    private var games: some View {
        let games = store.playing?.items ?? []
        if let trophies = store.trophies {
            TrophyCountsRow(counts: trophies.earned, level: trophies.profile.level)
                .padding(.vertical, 4)
        }
        if games.isEmpty {
            ContentUnavailableView("No Games", systemImage: "gamecontroller")
        } else {
            ForEach(games) { game in
                GameRow(game: game, digest: store.trophies?.titles.first(where: { $0.titleIds.contains(game.titleId) }))
                    .padding(12)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
            }
        }
    }
}

private struct AlbumTile: View {
    let item: ListeningItem

    var body: some View {
        let tile = VStack(alignment: .leading, spacing: 6) {
            RemoteImage(url: AssetURL.appleArtwork(item.artwork, points: 180))
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))
            Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
            Text(item.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        if let link = item.link.flatMap(URL.init(string:)) {
            Link(destination: link) { tile }.buttonStyle(.plain)
        } else {
            tile
        }
    }
}

private struct WatchingRow: View {
    let item: WatchingItem

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: AssetURL.resolve(item.poster))
                .frame(width: 60, height: 90)
                .clipShape(.rect(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(item.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if item.progress > 0 && item.progress < 100 {
                    ProgressView(value: item.progress, total: 100).tint(.primary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
        .contentShape(.rect)
    }
}

/**
 一集 / 一部的详情。顶部的剧照贴着屏幕上沿，用 `backgroundExtensionEffect` 把它镜像、模糊着
 延伸到状态栏和导航栏底下，而不是在那里留一条空白。
 */
private struct WatchingDetailView: View {
    let item: WatchingItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RemoteImage(url: AssetURL.resolve(item.backdrop ?? item.poster))
                    .frame(height: 260)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .backgroundExtensionEffect()

                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title).font(.title2.weight(.bold))
                    Text(item.subtitle).font(.body).foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Text(item.type.rawValue)
                        if let year = item.year { Text(String(year)) }
                        if let played = ISO8601Parsing.date(item.playedAt) { Text("Watched \(Format.relative(played))") }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if item.progress > 0 && item.progress < 100 {
                        ProgressView(value: item.progress, total: 100).tint(.primary)
                    }
                    if let link = item.link.flatMap(URL.init(string:)) {
                        Link(destination: link) {
                            Label("Open in Emby", systemImage: "play.rectangle.fill")
                        }
                        .buttonStyle(.glassProminent)
                        .padding(.top, 8)
                    }
                }
                .padding(.horizontal)
            }
        }
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
    }
}
