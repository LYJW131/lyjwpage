import SwiftUI

enum LibrarySection: String, CaseIterable, Identifiable {
    case music = "Music", watching = "Watching", workouts = "Workouts", games = "Games"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .music: "music.note"
        case .watching: "play.tv"
        case .workouts: "figure.run"
        case .games: "gamecontroller"
        }
    }
}

// 分区选择器在 Tab 栏底部附件里（照片 App 的位置），所以选中的分区由 `RootView` 持有
struct LibraryView: View {
    @Environment(LiveStore.self) private var store
    @Binding var section: LibrarySection
    // 推进详情页时 `RootView` 收起分区选择器，免得在详情里切走底下的列表
    @Binding var path: NavigationPath

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Group {
                    switch section {
                    case .music: music
                    case .watching: watching
                    case .workouts: workouts
                    case .games: games
                    }
                }
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .scrollIndicators(.hidden)
            .pageBackground()
            .navigationTitle(section.rawValue)
            .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
            .refreshable { await store.refresh([.listening, .watching, .workouts, .playing, .trophies]) }
            .navigationDestination(for: WatchingItem.ID.self) { id in
                if let item = store.watching?.items.first(where: { $0.id == id }) {
                    WatchingDetailView(item: item)
                }
            }
        }
    }

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
                // 行本身是卡片，List 自带的箭头会挂在卡片外面、把卡片挤窄
                .navigationLinkIndicatorVisibility(.hidden)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .accessibilityIdentifier("library.watching.\(item.id)")
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
                // 没有奖杯进度条的行（Netflix、YouTube 这类应用）不撑满，卡片会只包住文字
                GameRow(game: game, digest: store.trophies?.titles.first(where: { $0.titleIds.contains(game.titleId) }))
                    .frame(maxWidth: .infinity, alignment: .leading)
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
            RemoteImage(url: AssetURL.appleArtwork(item.artworkUrl, points: 180))
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

private struct WatchingDetailView: View {
    let item: WatchingItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 图按原图比例铺满时会把整列撑宽、文字挤出左边距：占位定尺寸，图放在覆盖层里
                Color.clear
                    .frame(height: 260)
                    .frame(maxWidth: .infinity)
                    .overlay { RemoteImage(url: AssetURL.resolve(item.backdrop ?? item.poster)) }
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

struct LibrarySectionPicker: View {
    @Binding var section: LibrarySection
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        Picker("Section", selection: $section) {
            ForEach(LibrarySection.allCases) { item in
                // 并进收起的 Tab 栏那一行时放不下四个单词，只留图标；无障碍名称仍是分区名
                if placement == .inline {
                    Label(item.rawValue, systemImage: item.systemImage).labelStyle(.iconOnly).tag(item)
                } else {
                    Text(item.rawValue).tag(item)
                }
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 8)
    }
}
