import SwiftUI

@MainActor
final class HubModel: ObservableObject {
    @Published var reading: RingReading?
    @Published var lastPush: PushRecord = HubSettings.lastPush
    @Published var note: String = ""
    @Published var busy = false
    @Published var needsAuthorization = false

    func refresh() async {
        reading = await Modules.activity.currentReading()
        needsAuthorization = await !Modules.activity.isAuthorized()
        lastPush = HubSettings.lastPush
    }

    func authorize() async {
        do {
            try await Modules.activity.requestAuthorization()
        } catch {
            note = "健康授权失败：\(error.localizedDescription)"
        }
        await refresh()
    }

    func report(force: Bool) async {
        busy = true
        defer { busy = false }

        switch await TelemetryHub.shared.report(force: force) {
        case let .pushed(count):
            note = count == 1 ? "已上报" : "已上报 \(count) 个模块"
        case .unchanged:
            note = "和上次一样，没有重发"
        case let .skipped(reason):
            note = reason
        case let .failed(reason):
            note = reason
        case .coalesced:
            // 上一句留着，见 TelemetryHub.Outcome.coalesced
            break
        }
        await refresh()
    }
}

struct DashboardView: View {
    @StateObject private var model = HubModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingSettings = false
    /// 开关放设置里，这里只读，回前台时重新取一次
    @State private var activityEnabled = HubSettings.isEnabled(Modules.activity.id)

    var body: some View {
        NavigationStack {
            List {
                Section(Modules.activity.title) {
                    if !activityEnabled {
                        Text("模块已关闭").foregroundStyle(.secondary)
                    } else if let reading = model.reading {
                        ActivityRingsRow(reading: reading)
                        Text(reading.date)
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                    } else {
                        // 没授权、或者手表当天还没同步过来，都是这一句
                        Text("读不到今天的活动记录").foregroundStyle(.secondary)
                        if model.needsAuthorization {
                            Button("允许读取健康数据") {
                                Task { await model.authorize() }
                            }
                        }
                    }
                }

                Section {
                    Button {
                        Task { await model.report(force: true) }
                    } label: {
                        HStack {
                            Text("立刻上报")
                            if model.busy {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(model.busy)
                } footer: {
                    Text("平时不用管：模块有新数据时系统会把这个 App 唤起来自己报。活动圆环那条路由 HealthKit 按小时节流，所以最快也就一小时一次 —— 想立刻看到就按这个。")
                }

                Section("最近一次上报") {
                    LabeledContent("时间") {
                        Text(model.lastPush.at.map(Self.stamp) ?? "还没报过")
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("结果") {
                        // 一次都没报过时不写「成功」—— 那是在替一件没发生的事下结论
                        Text(model.lastPush.at == nil ? "—" : (model.lastPush.error ?? "成功"))
                            .foregroundStyle(model.lastPush.error == nil ? .secondary : Color.red)
                            .multilineTextAlignment(.trailing)
                    }
                    if !model.note.isEmpty {
                        Text(model.note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("遥测中心")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("设置")
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
            }
        }
        .task {
            await model.refresh()
            if model.needsAuthorization {
                await model.authorize()
            }
            // 回到前台就顺手报一次：这是唯一能绕开小时级节流的路子
            await model.report(force: false)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            activityEnabled = HubSettings.isEnabled(Modules.activity.id)
            Task {
                await model.refresh()
                await model.report(force: false)
            }
        }
        .onChange(of: showingSettings) { _, showing in
            // 从设置退回来：开关可能变了，读数和下一次上报都要跟着走
            guard !showing else { return }
            activityEnabled = HubSettings.isEnabled(Modules.activity.id)
            Task { await model.refresh() }
        }
    }

    private static func stamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}

/// 三环 + 三行读数。这一层**故意是具体的** —— 每个模块的展示形态天差地别，
/// 让 TelemetryModule 协议再背一个 `dashboardView()` 就过线了
private struct ActivityRingsRow: View {
    let reading: RingReading

    var body: some View {
        HStack(spacing: 20) {
            RingsView(reading: reading)
                .frame(width: 96, height: 96)
            VStack(alignment: .leading, spacing: 8) {
                RingRow(label: "活动", value: reading.moveKcal, goal: reading.moveGoalKcal, unit: "千卡", color: .moveRing)
                RingRow(label: "锻炼", value: reading.exerciseMinutes, goal: reading.exerciseGoalMinutes, unit: "分钟", color: .exerciseRing)
                RingRow(label: "站立", value: reading.standHours, goal: reading.standGoalHours, unit: "小时", color: .standRing)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct RingRow: View {
    let label: String
    let value: Double
    let goal: Double
    let unit: String
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).foregroundStyle(.secondary)
            Text("\(Int(value.rounded())) / \(Int(goal.rounded())) \(unit)")
                .font(.callout.monospacedDigit())
        }
    }
}

/// 三条同心弧，和站点那张卡同一个画法：从 12 点顺时针，超过 100% 画满就停
private struct RingsView: View {
    let reading: RingReading

    var body: some View {
        ZStack {
            arc(ratio: ratio(reading.moveKcal, reading.moveGoalKcal), color: .moveRing, inset: 0)
            arc(ratio: ratio(reading.exerciseMinutes, reading.exerciseGoalMinutes), color: .exerciseRing, inset: 15)
            arc(ratio: ratio(reading.standHours, reading.standGoalHours), color: .standRing, inset: 30)
        }
    }

    private func ratio(_ value: Double, _ goal: Double) -> Double {
        goal > 0 ? value / goal : 0
    }

    private func arc(ratio: Double, color: Color, inset: CGFloat) -> some View {
        ZStack {
            Circle().stroke(color.opacity(0.2), lineWidth: 11)
            // 圆头笔在 0% 时也会点出一个点，真的是 0 就整条不画
            if ratio > 0 {
                Circle()
                    .trim(from: 0, to: min(ratio, 1))
                    .stroke(color, style: StrokeStyle(lineWidth: 11, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .padding(inset)
    }
}

extension Color {
    // Apple 那三个颜色，和站点卡片上的一套 —— 「哪个圈是锻炼」全靠它认
    static let moveRing = Color(red: 0.98, green: 0.07, blue: 0.31)
    static let exerciseRing = Color(red: 0.57, green: 0.91, blue: 0.16)
    static let standRing = Color(red: 0.12, green: 0.92, blue: 0.94)
}
