import SwiftUI

/**
 lyjwpage 的原生 App：把个人主页上那些实时状态用原生界面看，同时是这台 iPhone 的上报器。

 两件事各走各的路：
 - **看**（`LiveStore`）只在前台：读站点公开的状态 API、连推送，和浏览器访客看到的是同一份事实。
 - **报**（`TelemetryHub`）主要在后台：HealthKit 有新样本时系统把 App 拉起来，报完就睡。
   协议见 `TelemetryModule`，链路说明见 README「上报」。
 */
@main
struct LyjwpageApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = LiveStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                // 站点图片（R2 内容地址、Apple 封面、PSN 图）都是不可变的，一份磁盘缓存全 App 共用
                .asyncImageURLSession(ImagePipeline.session)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            switch phase {
            case .active:
                store.activate()
                Task { await HubForeground.run() }
            case .background: store.deactivate()
            default: break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        /**
         各模块的唤醒源**每次启动都要重新注册**，包括系统把 App 从后台拉起来的那次。

         所以它挂在这里，不挂在某个 view 的 `onAppear` 上 —— 后台被拉起时压根没有
         view 被创建，注册不上就等于后台上报整个不工作，而前台点一下又一切正常，
         是那种放两天才会发现的坏法。
         */
        Task { await TelemetryHub.shared.start() }
        return true
    }
}

/**
 App 每次回到前台时上报器要做的事。挂在 App 层而不是某个 Tab 上：Tab 没被点开时它的视图
 可能根本没建，挂在视图上就等于「不打开 iPhone 那页就不报」。
 */
@MainActor
enum HubForeground {
    static func run() async {
        // 只有前台能弹授权表单；问过一次之后 isAuthorized 就为真（HealthKit 不透露给没给），不会反复弹
        for module in Modules.all where HubSettings.isEnabled(module.id) {
            if await !module.isAuthorized() {
                try? await module.requestAuthorization()
            }
        }
        // 回到前台就顺手报一次：这是唯一能绕开 HealthKit 小时级节流的路子
        _ = await TelemetryHub.shared.report(force: false)
    }
}

enum ImagePipeline {
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: configuration)
    }()
}
