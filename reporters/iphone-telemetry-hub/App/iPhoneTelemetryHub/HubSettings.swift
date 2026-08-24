import Foundation
import Security

/// 上报目的地。地址存 UserDefaults，密钥存钥匙串
struct Destination: Sendable {
    var url: URL
    var secret: String
}

/// 上一次上报的结果，给界面显示用
struct PushRecord: Sendable {
    var at: Date?
    /// nil 表示成功
    var error: String?
}

/**
 配置和上次结果的存放处。密钥进钥匙串、其余进 UserDefaults，和 MacTelemetryHub
 那边一套写法。

 上次结果也存下来，是因为**大部分上报发生在后台**（系统把 App 拉起来、推完就又
 睡了），那时没有界面可以更新。存一份，回前台时照着显示，才看得出「昨晚到底有没有
 在报」。
 */
enum HubSettings {
    private static let service = "com.liangyangjunwei.iPhoneTelemetryHub"
    private static let secretAccount = "telemetry-ingest-secret"
    private static let endpointKey = "endpointURL"
    private static let lastPushAtKey = "lastPushAt"
    private static let lastErrorKey = "lastPushError"
    private static func moduleKey(_ id: String) -> String { "module.\(id).enabled" }

    static var endpoint: String {
        get { UserDefaults.standard.string(forKey: endpointKey) ?? "" }
        set {
            UserDefaults.standard.set(
                newValue.trimmingCharacters(in: .whitespacesAndNewlines),
                forKey: endpointKey
            )
        }
    }

    static var secret: String {
        get { keychainRead() ?? "" }
        set { keychainWrite(newValue.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    /// 地址填全了才算配好。没配好时上报直接跳过，不去打一个空 URL
    static func destination() -> Destination? {
        guard let url = URL(string: endpoint), url.scheme != nil, url.host != nil else { return nil }
        return Destination(url: url, secret: secret)
    }

    /// 模块开关，**默认开** —— 装上就该开始报，不该等人再去打开一次
    static func isEnabled(_ moduleID: String) -> Bool {
        UserDefaults.standard.object(forKey: moduleKey(moduleID)) as? Bool ?? true
    }

    static func setEnabled(_ enabled: Bool, for moduleID: String) {
        UserDefaults.standard.set(enabled, forKey: moduleKey(moduleID))
    }

    static func record(error: String?) {
        let defaults = UserDefaults.standard
        // 失败也记时刻：界面要能说「10 分钟前试过、被拒了」，而不是停在上次成功那一刻
        defaults.set(Date().timeIntervalSince1970, forKey: lastPushAtKey)
        defaults.set(error, forKey: lastErrorKey)
    }

    static var lastPush: PushRecord {
        let defaults = UserDefaults.standard
        let stamp = defaults.double(forKey: lastPushAtKey)
        return PushRecord(
            at: stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil,
            error: defaults.string(forKey: lastErrorKey)
        )
    }

    // MARK: - 钥匙串

    private static func keychainRead() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: secretAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func keychainWrite(_ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: secretAccount,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }

        var item = base
        item[kSecValueData as String] = data
        /**
         解锁后可读，且**允许后台访问**。

         默认的 `WhenUnlocked` 在这里不够：系统会在手机锁着的时候把 App 拉起来
         上报，那时读不到密钥就只能带着空 Authorization 头去打站点、被 401 拒掉。
         `AfterFirstUnlock` 是「开机后解锁过一次就能读」，正好覆盖这种场景。
         */
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }
}
