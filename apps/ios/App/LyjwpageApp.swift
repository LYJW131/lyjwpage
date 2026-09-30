import SwiftUI

@main
struct LyjwpageApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = LiveStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                // 界面文案全英文；不注入的话 Text(date, format:) 跟系统语言走，中文系统上会冒出「10月1日」
                .environment(\.locale, Format.locale)
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
        // 唤醒源每次启动都要重新注册：后台被拉起时没有 view 被创建，挂在 onAppear 上后台上报就整个不工作
        Task { await TelemetryHub.shared.start() }
        return true
    }
}

// 挂在 App 层而不是某个 Tab 上：没点开的 Tab 视图可能根本没建，挂在视图上就成了不打开那页就不报
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
