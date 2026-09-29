import Foundation

/**
 一个上报模块：交出快照、注册自己的唤醒源（HealthKit 的观测之类）。

 在 `Modules.all` 登记即可，`TelemetryHub` 不认识任何具体模块 —— 这个协议为此存在。
 界面那层反过来是具体的：`DashboardView` 直接认识各个模块并画它们，让协议再背一个
 `dashboardView()` 就过线了，每个模块的展示形态本来就千差万别。
 */
protocol TelemetryModule: Sendable {
    /// 信封里 `modules` 的键。和站点 `/api/status/*` 的主题同名：activity ↔ /api/status/activity
    var id: String { get }
    /// 界面上给人看的名字
    var title: String { get }

    /// 是否无需再次请求授权。不代表读权限已批准：HealthKit 不透露读权限的结果，
    /// 拿不拿得到数据要看 `snapshot()`
    func isAuthorized() async -> Bool
    /// 只能由前台发起 —— 系统的授权表单需要一个正在前台的 App
    func requestAuthorization() async throws

    /**
     注册这个模块自己的唤醒源，有新数据时调 `onChange`。

     **每次启动都会被调用**，包括系统把 App 从后台拉起来的那次，见 AppDelegate。
     */
    func startObserving(onChange: @escaping @Sendable () async -> Void) async

    /// 这一轮要发的内容。`nil` = 这次没有可发的（没授权、当天还没有数据……），不是错误
    func snapshot() async throws -> AnyEncodable?
}

/**
 类型擦除的 `Encodable`，好让一个信封装下形状各异的模块。

 没有它就只能像 Mac 那样写一个「每个模块一个可选字段」的具体结构体，那样 hub 会
 认识每一个模块的类型，加一个模块就得改 hub。
 */
struct AnyEncodable: Encodable, Sendable {
    private let write: @Sendable (Encoder) throws -> Void

    init<T: Encodable & Sendable>(_ value: T) {
        write = { try value.encode(to: $0) }
    }

    func encode(to encoder: Encoder) throws {
        try write(encoder)
    }
}

/**
 发往站点的唯一信封，对着 `shared/ingest/phone.ts` 的 `preparePhoneEnvelope`。

 只带这一轮真的变了的模块 —— 内容没变的那些不进 `modules`，站点那边看到什么就
 更新什么。

 **骨架照抄 Mac，字段不照抄。** 那份信封还有 `heartbeatAt` / `presence` /
 `activeModules`，这里一个都没有：它们在那边成立是因为 Mac 上跑的是常驻进程，
 心跳能证明它还活着。这个 App 平时**根本不在运行**，硬发一个心跳只会让站点以为
 自己能判断手机在不在线 —— 判不了。
 */
struct TelemetryEnvelope: Encodable, Sendable {
    /// 从 1 起，不接着 Mac 的 4：两套协议各活各的
    let version = 1
    let modules: [String: AnyEncodable]
}

/// 全部模块的登记处。加模块只动这里和它自己那个文件
enum Modules {
    static let activity = ActivityModule()

    static let workouts = WorkoutsModule()

    static let all: [any TelemetryModule] = [activity, workouts]
}
