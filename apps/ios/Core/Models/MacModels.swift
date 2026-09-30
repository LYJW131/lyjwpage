import Foundation

/**
 Mac 上报器那一路的存活字段。站点把它们拼进每份载荷，Swift 没有交叉类型，所以各载荷自己
 声明这三项、再遵守这个协议。判活规则见 `Freshness.macIsStale`。
 */
protocol ReporterPresence {
    /// 站点收到 Mac 最后一次心跳的时刻，epoch 毫秒（站点时钟）
    var lastSeenAt: Double { get }
    var declaredOffline: Bool { get }
    var heartbeatWindowMs: Double { get }
}

struct DesktopActivity: Decodable, Sendable, Equatable {
    let applicationName: String
    let bundleIdentifier: String?
    let windowTitle: String?
    /// `/img/<objectKey>` 同源路径，用 `AssetURL.resolve` 补成绝对地址
    let iconUrl: String?
    let observedAt: Double

    /// 隐私开关打开时 Mac 上报器用的占位 bundle id，站点写 Hidden
    static let hiddenBundleID = "com.liangyangjunwei.MacTelemetryHub.hidden"
    static let lockScreenBundleID = "com.apple.loginwindow"

    var isHidden: Bool { bundleIdentifier == Self.hiddenBundleID }
    var isLockScreen: Bool { bundleIdentifier == Self.lockScreenBundleID }
}

struct DesktopPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let desktop: DesktopActivity?
    let receivedAt: Double?
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double
}

struct TimezoneActivity: Decodable, Sendable, Equatable {
    let identifier: String
    let abbreviation: String?
    let secondsFromGMT: Int
    let observedAt: Double
}

struct TimezonePayload: Decodable, Sendable, Equatable {
    let timezone: TimezoneActivity?
    let snapshotAt: Double
}

struct DeviceInfo: Decodable, Sendable, Equatable {
    let serialNumber: String?
    let firmwareVersion: String?
    let model: String?
}

/// 功率 W、电压 V、电流 A
struct ChargerPort: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let active: Bool
    let power: Double?
    let voltage: Double?
    let current: Double?
    let device: String?
    let `protocol`: String?
    let cable: String?
}

struct ChargerSample: Decodable, Sendable, Equatable {
    /// epoch 毫秒
    let t: Double
    /// 瓦
    let w: Double
}

struct ChargerCover: Decodable, Sendable, Equatable {
    let name: String
    let iconUrl: String?
}

/// 推送里的这份 `history` 永远是空的（`historyPartial: true`），曲线要接在已有的那份上
struct ChargerPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let connected: Bool
    let totalPower: Double
    let maxPower: Double
    let ports: [ChargerPort]
    let device: DeviceInfo
    let cover: ChargerCover?
    let updatedAt: Double?
    let history: [ChargerSample]
    let historyPartial: Bool
    let pushedAt: Double
    let staleAfterMs: Double
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double

    func replacingHistory(_ history: [ChargerSample]) -> ChargerPayload {
        ChargerPayload(
            connected: connected, totalPower: totalPower, maxPower: maxPower, ports: ports,
            device: device, cover: cover, updatedAt: updatedAt, history: history,
            historyPartial: historyPartial, pushedAt: pushedAt, staleAfterMs: staleAfterMs,
            lastSeenAt: lastSeenAt, declaredOffline: declaredOffline, heartbeatWindowMs: heartbeatWindowMs
        )
    }
}

struct PowerBankPort: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let active: Bool
    /// "in" / "out"，没接东西时为 null
    let direction: String?
    let attached: Bool
    let power: Double?
    let voltage: Double?
    let current: Double?
}

struct PowerBankPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let connected: Bool
    /// 百分比
    let battery: Double?
    let charging: Bool
    let timeToFullMinutes: Double?
    let thermalLimited: Bool
    let batteryHealth: Double?
    let inputPower: Double
    let outputPower: Double
    /// 摄氏度
    let temperatures: [Double]
    let ports: [PowerBankPort]
    let device: DeviceInfo
    let updatedAt: Double?
    let pushedAt: Double
    let staleAfterMs: Double
    let lastSeenAt: Double
    let declaredOffline: Bool
    let heartbeatWindowMs: Double
}
