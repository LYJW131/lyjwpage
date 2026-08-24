import SwiftUI

/**
 iPhone 遥测中心。

 和 Mac 上那个（MacTelemetryHub）是同一件事的手机版：**一个入口、一个信封、
 一个模块字典**，只带这次真的变了的模块，POST 到个人主页的 `/api/ingest/iphone`。
 眼下只有活动圆环一个模块，加第二个只动 `Modules.all` 和它自己那个文件。

 和 Mac 那个最大的不同：**这个 App 平时根本不在运行**。它没有常驻进程、不发心跳、
 站点也判断不了它在不在线 —— 是模块自己的唤醒源（活动圆环那个是 HealthKit 的观测）
 把它从后台拉起来，报完就又睡了。信封里因此没有 presence 那一套，见 TelemetryModule。
 */
@main
struct iPhoneTelemetryHubApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            DashboardView()
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
