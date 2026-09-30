import SwiftUI

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
                    Text("地址填 https://ingest.homepage.lyjw.llc/api/ingest/iphone，Client ID 和 Client Secret 是 Cloudflare Access 里 lyjwpage-iphone 那把 service token。换钥就在 Zero Trust 里重新生成 Secret 再贴进来。Secret 存在钥匙串里，数据只发往这一个地址。")
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

    private func save() {
        HubSettings.endpoint = endpoint
        HubSettings.clientID = clientID
        HubSettings.secret = secret
        for (id, isOn) in enabled {
            HubSettings.setEnabled(isOn, for: id)
        }

        guard HubSettings.destination() != nil else {
            endpoint = HubSettings.endpoint
            note = "地址要带 https:// 和域名，Client ID 和 Client Secret 都要填"
            return
        }
        dismiss()
    }
}
