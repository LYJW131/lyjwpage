import SwiftUI

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
        // 后台唤醒不会创建 View；观测必须在每次应用启动时注册，不能挂在 onAppear。
        Task { await TelemetryHub.shared.start() }
        return true
    }
}
