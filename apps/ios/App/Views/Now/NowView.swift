import SwiftUI

/// 首页的卡片。顺序和显隐可以在「Arrange」里改，默认照站点首页
enum HomeCard: String, CaseIterable, Identifiable, Sendable {
    case watching, charging, listening, activity, coding, server, playstation, providers, site

    var id: String { rawValue }

    var title: String {
        switch self {
        case .watching: "Now Watching"
        case .charging: "Charging"
        case .listening: "Listening"
        case .activity: "Activity"
        case .coding: "Vibe Coding"
        case .server: "Exit Node"
        case .playstation: "PlayStation"
        case .providers: "Provider Status"
        case .site: "LYJWPAGE"
        }
    }

    var systemImage: String {
        switch self {
        case .watching: "play.tv.fill"
        case .charging: "bolt.fill"
        case .listening: "music.note"
        case .activity: "figure.walk"
        case .coding: "chevron.left.forwardslash.chevron.right"
        case .server: "server.rack"
        case .playstation: "gamecontroller.fill"
        case .providers: "checkmark.shield.fill"
        case .site: "globe"
        }
    }

    /// 只在对应的事发生时出现的卡，和站点首页一致；「Arrange」里照样能排它们的位置
    var appearsOnlyWhenActive: Bool { self == .watching || self == .charging }

    static let defaultOrder: [HomeCard] = allCases

    static func decode(_ stored: String) -> [HomeCard] {
        let parsed = stored.split(separator: ",").compactMap { HomeCard(rawValue: String($0)) }
        // 新加的卡补在末尾，删掉的卡自然消失
        return parsed + allCases.filter { !parsed.contains($0) }
    }

    static func encode(_ cards: [HomeCard]) -> String {
        cards.map(\.rawValue).joined(separator: ",")
    }
}

struct NowView: View {
    @Environment(LiveStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("home.cardOrder") private var storedOrder = HomeCard.encode(HomeCard.defaultOrder)
    @AppStorage("home.hiddenCards") private var storedHidden = ""
    @State private var arranging = false

    var body: some View {
        NavigationStack {
            // 过期、「Live」灯、相对时间都靠这个时钟翻过来；推送来的新数据会立刻重画，不必等它
            TimelineView(.periodic(from: .now, by: 15)) { context in
                ScrollView {
                    VStack(spacing: 14) {
                        MacHeader(now: context.date)
                        cards(now: context.date)
                        footer
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 24)
                }
            }
            .pageBackground()
            .navigationTitle("Now")
            .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
            .refreshable { await store.refreshAll() }
            .toolbar { toolbar }
            .navigationDestination(for: NowRoute.self) { route in
                switch route {
                case .coding: CodingDetailView()
                case .playstation: PlayStationDetailView()
                }
            }
            .sheet(isPresented: $arranging) {
                ArrangeCardsView(storedOrder: $storedOrder, storedHidden: $storedHidden)
                    .presentationDetents([.medium, .large])
                    .navigationTransition(.crossFade)
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            ConnectionBadge()
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Arrange", systemImage: "rectangle.stack") { arranging = true }
        }
        .visibilityPriority(.high)
        ToolbarOverflowMenu {
            Link(destination: SiteHosts.site) {
                Label("Open lyjw.me", systemImage: "safari")
            }
            ShareLink(item: SiteHosts.site) {
                Label("Share Site", systemImage: "square.and.arrow.up")
            }
            Button("Refresh All", systemImage: "arrow.clockwise") {
                Task { await store.refreshAll() }
            }
        }
    }

    // MARK: 卡片

    private var order: [HomeCard] { HomeCard.decode(storedOrder) }
    private var hidden: Set<String> { Set(storedHidden.split(separator: ",").map(String.init)) }

    private func isShown(_ card: HomeCard, now: Date) -> Bool {
        guard !hidden.contains(card.rawValue) else { return false }
        switch card {
        case .watching: return store.nowWatchingItem != nil
        case .charging: return store.chargerIsActive(now: now) || store.powerBankIsActive(now: now)
        default: return true
        }
    }

    @ViewBuilder
    private func cards(now: Date) -> some View {
        let visible = order.filter { isShown($0, now: now) }
        // 宽窗口（iPhone Duo 展开、iPad 上的 iPhone App、台前调度）排两列；HIG 建议折叠屏上用偶数列
        if sizeClass == .regular {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 14, alignment: .top), GridItem(.flexible(), spacing: 14, alignment: .top)],
                alignment: .leading,
                spacing: 14
            ) {
                ForEach(visible) { card in cardView(card, now: now) }
            }
        } else {
            LazyVStack(spacing: 14) {
                ForEach(visible) { card in cardView(card, now: now) }
            }
        }
    }

    @ViewBuilder
    private func cardView(_ card: HomeCard, now: Date) -> some View {
        switch card {
        case .watching: NowWatchingCard(now: now)
        case .charging: ChargingCard(now: now)
        case .listening: ListeningCard(now: now)
        case .activity: ActivityCard(now: now)
        case .coding: CodingCard(now: now)
        case .server: ServerCard(now: now)
        case .playstation: PlayStationCard(now: now)
        case .providers: ProviderStatusCard(now: now)
        case .site: SiteCard(now: now)
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            if let online = store.online {
                LiveDot(size: 6)
                Text("\(online) online now")
            } else {
                Text("Offline")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.top, 8)
    }
}

enum NowRoute: Hashable {
    case coding, playstation
}

/// 左上角：推送连着没有。连着就是实时的，断了卡片退回按间隔轮询
private struct ConnectionBadge: View {
    @Environment(LiveStore.self) private var store

    var body: some View {
        switch store.socketState {
        case .open:
            Label("Live", systemImage: "dot.radiowaves.up.forward")
                .symbolEffect(.variableColor.iterative, options: .repeating)
                .foregroundStyle(Color.live)
                .accessibilityLabel("Live updates connected")
        case .connecting:
            ProgressView()
                .accessibilityLabel("Connecting")
        case .closed:
            Label("Offline", systemImage: "wifi.slash")
                .foregroundStyle(.secondary)
                .accessibilityLabel("Live updates disconnected")
        }
    }
}

/**
 卡片排序与显隐。拖动排序用 iOS 27 的 `reorderable()` / `reorderContainer`，顺序存在
 `@AppStorage` 里，只在这台手机上生效。
 */
private struct ArrangeCardsView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var storedOrder: String
    @Binding var storedHidden: String

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(HomeCard.decode(storedOrder)) { card in
                        Toggle(isOn: visibility(card)) {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(card.title)
                                    if card.appearsOnlyWhenActive {
                                        Text("Appears only while it's happening")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: card.systemImage)
                            }
                        }
                    }
                    .reorderable()
                } footer: {
                    Text("Drag to reorder. The order only applies to this iPhone.")
                }
            }
            .reorderContainer(for: HomeCard.self) { difference in
                storedOrder = HomeCard.encode(apply(difference, to: HomeCard.decode(storedOrder)))
            }
            .navigationTitle("Arrange Cards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        storedOrder = HomeCard.encode(HomeCard.defaultOrder)
                        storedHidden = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) { dismiss() }
                }
            }
        }
    }

    private func visibility(_ card: HomeCard) -> Binding<Bool> {
        Binding {
            !storedHidden.split(separator: ",").contains(Substring(card.rawValue))
        } set: { shown in
            var hidden = Set(storedHidden.split(separator: ",").map(String.init))
            if shown { hidden.remove(card.rawValue) } else { hidden.insert(card.rawValue) }
            storedHidden = hidden.sorted().joined(separator: ",")
        }
    }

    private func apply(
        _ difference: ReorderDifference<HomeCard.ID, ReorderableSingleCollectionIdentifier>,
        to cards: [HomeCard]
    ) -> [HomeCard] {
        let moving = difference.sources.compactMap { HomeCard(rawValue: $0) }
        var remaining = cards.filter { !difference.sources.contains($0.id) }
        switch difference.destination.position {
        case let .before(id):
            let index = remaining.firstIndex { $0.id == id } ?? remaining.endIndex
            remaining.insert(contentsOf: moving, at: index)
        case .end:
            remaining.append(contentsOf: moving)
        @unknown default:
            remaining.append(contentsOf: moving)
        }
        return remaining
    }
}
