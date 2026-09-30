import SwiftUI

enum AppTab: Hashable {
    case now, pulse, library, device
}

struct RootView: View {
    @Environment(LiveStore.self) private var store
    @State private var tab: AppTab = .now
    @State private var librarySection: LibrarySection = .music
    @State private var libraryPath = NavigationPath()
    @State private var showingPlayer = false
    // 附件的显隐也要跟着钟走：Mac 心跳过窗时没有任何推送，只能靠时间把它翻过来
    @State private var now = Date()
    @Namespace private var playerTransition

    var body: some View {
        TabView(selection: $tab) {
            Tab("Now", systemImage: "dot.radiowaves.left.and.right", value: AppTab.now) {
                NowView()
            }
            Tab("Pulse", systemImage: "waveform.path.ecg", value: AppTab.pulse) {
                PulseView()
            }
            Tab("Library", systemImage: "square.stack.fill", value: AppTab.library) {
                LibraryView(section: $librarySection, path: $libraryPath)
            }
            Tab("iPhone", systemImage: "iphone", value: AppTab.device, role: .prominent) {
                DeviceView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: tab == .library ? libraryPath.isEmpty : store.liveTrack(now: now) != nil) {
            if tab == .library {
                LibrarySectionPicker(section: $librarySection)
            } else {
                MiniPlayer { showingPlayer = true }
                    .matchedTransitionSource(id: "player", in: playerTransition)
            }
        }
        .sheet(isPresented: $showingPlayer) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
                .navigationTransition(.zoom(sourceID: "player", in: playerTransition))
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                now = .now
            }
        }
    }
}
