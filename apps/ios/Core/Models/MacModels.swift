import Foundation

protocol ReporterPresence {
    // epoch 毫秒，站点时钟。
    var lastSeenAt: Double { get }
    var declaredOffline: Bool { get }
    var heartbeatWindowMs: Double { get }
}

struct DesktopActivity: Decodable, Sendable, Equatable {
    let applicationName: String
    let bundleIdentifier: String?
    let windowTitle: String?
    let iconUrl: String?
    let observedAt: Double

    // 须与 Mac 上报器隐私开关的占位 bundle id 一致。
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

// 功率 W、电压 V、电流 A。
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
    // epoch 毫秒。
    let t: Double
    // 瓦。
    let w: Double
}

struct ChargerCover: Decodable, Sendable, Equatable {
    let name: String
    let iconUrl: String?
}

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
    // 没接东西时为 null。
    let direction: String?
    let attached: Bool
    let power: Double?
    let voltage: Double?
    let current: Double?
}

struct PowerBankPayload: Decodable, Sendable, Equatable, ReporterPresence {
    let connected: Bool
    // 百分比。
    let battery: Double?
    let charging: Bool
    let timeToFullMinutes: Double?
    let thermalLimited: Bool
    let batteryHealth: Double?
    let inputPower: Double
    let outputPower: Double
    // 摄氏度。
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
