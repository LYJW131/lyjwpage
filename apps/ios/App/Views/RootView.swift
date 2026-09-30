import SwiftUI

enum AppTab: Hashable {
    case now, pulse, library, device
}

/**
 四个分区：此刻（站点首页那些卡）、Pulse（最近 24 小时）、Library（听过看过玩过练过的）、
 这台 iPhone（上报器）。最后一个用 `.prominent` 单独摆在 Tab 栏末端：它是「这台设备在做什么」，
 和前三个「站点在展示什么」不是一类。

 正在听的歌放在 Tab 栏的底部附件里，跟系统音乐 App 的迷你播放器一个位置；往下滚时 Tab 栏收起、
 附件并进同一行。点它展开完整的正在播放。
 */
struct RootView: View {
    @Environment(LiveStore.self) private var store
    @State private var tab: AppTab = .now
    @State private var showingPlayer = false
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
                LibraryView()
            }
            Tab("iPhone", systemImage: "iphone", value: AppTab.device, role: .prominent) {
                DeviceView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: store.liveTrack(now: .now) != nil) {
            MiniPlayer { showingPlayer = true }
                .matchedTransitionSource(id: "player", in: playerTransition)
        }
        .sheet(isPresented: $showingPlayer) {
            NowPlayingView()
                .navigationTransition(.zoom(sourceID: "player", in: playerTransition))
        }
    }
}
