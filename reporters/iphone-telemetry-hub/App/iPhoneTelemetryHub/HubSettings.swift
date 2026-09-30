import Foundation
import Security

struct Destination: Sendable {
    var url: URL
    var clientID: String
    var secret: String
}

struct PushRecord: Sendable {
    var at: Date?
    var error: String?
}

enum HubSettings {
    private static let service = "com.liangyangjunwei.iPhoneTelemetryHub"
    private static let secretAccount = "telemetry-ingest-secret"
    private static let endpointKey = "endpointURL"
    private static let clientIDKey = "accessClientID"
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

    static var clientID: String {
        get { UserDefaults.standard.string(forKey: clientIDKey) ?? "" }
        set {
            UserDefaults.standard.set(
                newValue.trimmingCharacters(in: .whitespacesAndNewlines),
                forKey: clientIDKey
            )
        }
    }

    static var secret: String {
        get { keychainRead() ?? "" }
        set { keychainWrite(newValue.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    static func destination() -> Destination? {
        guard let url = URL(string: endpoint), url.scheme != nil, url.host != nil else { return nil }
        guard !clientID.isEmpty, !secret.isEmpty else { return nil }
        return Destination(url: url, clientID: clientID, secret: secret)
    }

    static func isEnabled(_ moduleID: String) -> Bool {
        UserDefaults.standard.object(forKey: moduleKey(moduleID)) as? Bool ?? true
    }

    static func setEnabled(_ enabled: Bool, for moduleID: String) {
        UserDefaults.standard.set(enabled, forKey: moduleKey(moduleID))
    }

    static func record(error: String?) {
        let defaults = UserDefaults.standard
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
        // 后台唤醒时手机可能仍锁着；WhenUnlocked 会让上报读不到密钥。
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }
}
