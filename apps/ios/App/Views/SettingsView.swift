import SwiftUI

/**
 上报地址、Access 凭据、模块开关。

 和 Mac 那个的设置窗口对应；模块开关按 `Modules.all` 现列，加模块不用改这里。
 */
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var endpoint = HubSettings.endpoint
    @State private var clientID = HubSettings.clientID
    @State private var secret = HubSettings.secret
    @State private var enabled: [String: Bool] = Dictionary(
        uniqueKeysWithValues: Modules.all.map { ($0.id, HubSettings.isEnabled($0.id)) }
    )
    @State private var note = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    // 三项都手填。占位符不写成一个完整 URL —— 那看着就像已经填好了
                    TextField("Endpoint", text: $endpoint)
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
                    Text("Report To")
                } footer: {
                    Text("Endpoint: https://ingest.homepage.lyjw.llc/api/ingest/iphone. Client ID and Client Secret are the lyjwpage-iphone service token in Cloudflare Access; to rotate, regenerate the secret in Zero Trust and paste it here. The secret lives in the Keychain and is only sent to this endpoint.")
                }

                Section {
                    ForEach(Modules.all, id: \.id) { module in
                        Toggle(module.title, isOn: Binding(
                            get: { enabled[module.id] ?? true },
                            set: { enabled[module.id] = $0 }
                        ))
                    }
                } header: {
                    Text("Modules")
                } footer: {
                    Text("Disabled modules are neither collected nor reported. The site keeps showing the last report — it won't turn \"offline\", because this path has no liveness check.")
                }

                if !note.isEmpty {
                    Section {
                        Text(note).font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section {
                    LabeledContent("Version", value: AppIdentity.version)
                    Link("Open lyjw.me", destination: SiteHosts.site)
                } header: {
                    Text("About")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }
                }
            }
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
            note = "The endpoint needs https:// and a host, and both Client ID and Client Secret are required."
            return
        }
        dismiss()
    }
}
