import CryptoKit
import Foundation
import Security

/// 发往自家 Worker 的请求一律带这个 UA：Cloudflare 的浏览器完整性检查会拦某些默认 UA
enum HubUserAgent {
    static let value: String = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2"
        return "iphone-telemetry-hub/\(version)"
    }()
}

/// 配对换来的凭据，对应兑换口的 `data`
struct PairingCredentials: Sendable, Decodable {
    var source: String
    var clientId: String
    var clientSecret: String
    var ingestUrl: String
}

enum PairingError: LocalizedError {
    case denied
    case stateMismatch
    case missingCode
    case server(String)
    case badResponse(status: Int)

    var errorDescription: String? {
        switch self {
        case .denied: "在确认页点了拒绝，旧凭据照常可用"
        case .stateMismatch: "回调的 state 对不上，不是这次发起的配对，已丢弃"
        case .missingCode: "回调里没有授权码"
        case .server(let message): "兑换被拒：\(message)"
        case .badResponse(let status): "兑换口回了 HTTP \(status)"
        }
    }
}

/**
 上报器配对（`docs/reporter-pairing.md`）：授权码 + PKCE，只换这台设备那把
 Access service token。

 这里只管协议本身；弹浏览器那一步由界面用 SwiftUI 的 `webAuthenticationSession`
 做，拿回回调 URL 交给 `code(from:)`。
 */
struct PairingRequest: Sendable {
    static let source = "iphone"
    static let callbackScheme = "iphonetelemetryhub"
    static let redirectURI = "\(callbackScheme)://pair"
    private static let authorizeURL = "https://api.homepage.lyjw.llc/pair/authorize"
    private static let tokenURL = URL(string: "https://api.homepage.lyjw.llc/api/pair/token")!

    let verifier: String
    let state: String

    init() {
        verifier = Self.randomBase64URL(byteCount: 32)
        state = Self.randomBase64URL(byteCount: 16)
    }

    var challenge: String {
        Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    var authorizeURL: URL {
        var components = URLComponents(string: Self.authorizeURL)!
        components.queryItems = [
            URLQueryItem(name: "source", value: Self.source),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        return components.url!
    }

    /// 核对 state 后取出授权码。state 先于 error 核对：对不上的回调连「拒绝」都不认
    func code(from callback: URL) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        guard value("state") == state else { throw PairingError.stateMismatch }
        if let error = value("error") {
            throw error == "access_denied" ? PairingError.denied : PairingError.server(error)
        }
        guard let code = value("code"), !code.isEmpty else { throw PairingError.missingCode }
        return code
    }

    /// 兑换。成功即轮换：旧 secret 当场作废，新 secret 只在这个响应里出现一次
    func exchange(code: String) async throws -> PairingCredentials {
        var request = URLRequest(url: Self.tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(HubUserAgent.value, forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(["code": code, "codeVerifier": verifier])
        request.timeoutInterval = 30

        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        struct Envelope: Decodable {
            var ok: Bool
            var data: PairingCredentials?
            var error: String?
        }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
            throw PairingError.badResponse(status: status)
        }
        guard envelope.ok, (200..<300).contains(status), let credentials = envelope.data else {
            throw PairingError.server(envelope.error ?? "HTTP \(status)")
        }
        return credentials
    }

    // MARK: - base64url

    private static func randomBase64URL(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes 失败：\(status)")
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
