import AuthenticationServices
import SwiftUI

/**
 上报地址、Access 凭据、模块开关。

 和 Mac 那个的设置窗口对应；模块开关按 `Modules.all` 现列，加模块不用改这里。
 */
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    @State private var endpoint = HubSettings.endpoint
    @State private var clientID = HubSettings.clientID
    @State private var secret = HubSettings.secret
    @State private var enabled: [String: Bool] = Dictionary(
        uniqueKeysWithValues: Modules.all.map { ($0.id, HubSettings.isEnabled($0.id)) }
    )
    @State private var note = ""
    @State private var pairing = false
    @State private var pairingResult: (text: String, failed: Bool)?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        Task { await pair() }
                    } label: {
                        HStack {
                            Text("登录 Cloudflare 获取上报凭据")
                            Spacer()
                            if pairing { ProgressView() }
                        }
                    }
                    .disabled(pairing)
                    if let pairingResult {
                        Text(pairingResult.text)
                            .font(.footnote)
                            .foregroundStyle(pairingResult.failed ? .red : .secondary)
                    }
                    // 手填是后备：配对服务不可用、或者本机联调时用。占位符不写成一个完整 URL —— 那看着就像已经填好了
                    TextField("上报地址", text: $endpoint)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Client ID", text: $clientID)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Client Secret", text: $secret)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("上报到哪儿")
                } footer: {
                    Text("点「登录」在浏览器里用 Cloudflare Access 登录并确认，三项会自动填好并立即存下；重新登录就是换钥，旧 Secret 当场作废。登录不了时再手填：地址填 https://ingest.homepage.lyjw.llc/api/ingest/iphone，Client ID 和 Client Secret 是 Cloudflare Access 里 lyjwpage-iphone 那把 service token。Secret 存在钥匙串里，数据只发往这一个地址。")
                }

                Section {
                    ForEach(Modules.all, id: \.id) { module in
                        Toggle(module.title, isOn: Binding(
                            get: { enabled[module.id] ?? true },
                            set: { enabled[module.id] = $0 }
                        ))
                    }
                } header: {
                    Text("模块")
                } footer: {
                    Text("关掉的模块不采集也不上报。站点那边的数据会停在最后一次上报上 —— 它不会因此变成「离线」，这条链路本来就没有存活判定。")
                }

                if !note.isEmpty {
                    Section {
                        Text(note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                }
            }
        }
    }

    /**
     配对登录（`docs/reporter-pairing.md`）。兑换成功的那一刻服务端已经换了钥、旧 Secret 作废，
     所以凭据**当场写进设置**，不等「保存」—— 否则点了「取消」，手里只剩一把失效的旧钥。
     */
    private func pair() async {
        pairing = true
        pairingResult = nil
        defer { pairing = false }

        let request = PairingRequest()
        do {
            let callback = try await webAuthenticationSession.authenticate(
                using: request.authorizeURL,
                callback: .customScheme(PairingRequest.callbackScheme),
                preferredBrowserSession: .shared,
                additionalHeaderFields: [:]
            )
            let code = try request.code(from: callback)
            let credentials = try await request.exchange(code: code)

            HubSettings.endpoint = credentials.ingestUrl
            HubSettings.clientID = credentials.clientId
            HubSettings.secret = credentials.clientSecret
            endpoint = HubSettings.endpoint
            clientID = HubSettings.clientID
            secret = HubSettings.secret
            note = ""
            pairingResult = ("已登录，凭据已存好（\(credentials.clientId)）。回主页按一次「立刻上报」验证。", false)
        } catch ASWebAuthenticationSessionError.canceledLogin {
            pairingResult = ("登录取消了，旧凭据照常可用", false)
        } catch {
            pairingResult = ("登录没成功：\(error.localizedDescription)", true)
        }
    }

    private func save() {
        HubSettings.endpoint = endpoint
        HubSettings.clientID = clientID
        HubSettings.secret = secret
        for (id, isOn) in enabled {
            HubSettings.setEnabled(isOn, for: id)
        }

        guard HubSettings.destination() != nil else {
            // 地址不成立就不关窗：关掉的话人以为存上了，实际每次上报都在跳过
            endpoint = HubSettings.endpoint
            note = "地址要带 https:// 和域名，Client ID 和 Client Secret 都要填（或者直接点上面的登录）"
            return
        }
        dismiss()
    }
}
