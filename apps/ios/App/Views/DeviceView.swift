import Combine
import SwiftUI
import Observation

@MainActor
@Observable
final class HubModel {
    var reading: RingReading?
    var workouts: [WorkoutReading] = []
    var workoutError: String?
    var lastPush: PushRecord = HubSettings.lastPush
    var note: String = ""
    var busy = false
    var needsAuthorization = false

    func refresh() async {
        reading = await Modules.activity.currentReading()
        needsAuthorization = false
        for module in Modules.all where HubSettings.isEnabled(module.id) {
            if await !module.isAuthorized() { needsAuthorization = true }
        }
        do {
            workouts = try await Modules.workouts.recentWorkouts()
            workoutError = nil
        } catch {
            workoutError = error.localizedDescription
        }
        lastPush = HubSettings.lastPush
    }

    func authorize() async {
        do {
            for module in Modules.all where HubSettings.isEnabled(module.id) {
                try await module.requestAuthorization()
            }
        } catch {
            note = "Health authorization failed: \(error.localizedDescription)"
        }
        await refresh()
    }

    func report(force: Bool) async {
        busy = true
        defer { busy = false }

        switch await TelemetryHub.shared.report(force: force) {
        case let .pushed(count):
            note = count == 1 ? "Reported 1 module" : "Reported \(count) modules"
        case .unchanged:
            note = "Nothing changed since the last report"
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

/**
 这台 iPhone 作为上报器的样子：本机 HealthKit 读到的圈和训练、最近一次上报、授权。

 这一页读的是**本机**（HealthKit），「Now」那页读的是**站点**；两边对得上，就说明上报链路是通的。
 界面这层故意是具体的 —— 每个模块的展示形态天差地别，让 TelemetryModule 协议再背一个
 `dashboardView()` 就过线了。
 */
struct DeviceView: View {
    @State private var model = HubModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingSettings = false
    /// 开关放设置里，这里只读，回前台时重新取一次
    @State private var activityEnabled = HubSettings.isEnabled(Modules.activity.id)
    @State private var workoutsEnabled = HubSettings.isEnabled(Modules.workouts.id)

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Last report") {
                        Text(model.lastPush.at.map { Format.relative($0) } ?? "Never")
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("Result") {
                        // 一次都没报过时不写成功 —— 那是在替一件没发生的事下结论
                        Text(model.lastPush.at == nil ? "—" : (model.lastPush.error ?? "Delivered"))
                            .foregroundStyle(model.lastPush.error == nil ? Color.secondary : Color.red)
                            .multilineTextAlignment(.trailing)
                    }
                    if !model.note.isEmpty {
                        Text(model.note).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Reporter")
                } footer: {
                    Text("You rarely need to report by hand: when HealthKit has new samples the system wakes this app in the background and it reports on its own. Rings are throttled to about once an hour; opening the app or tapping Report sends one right away.")
                }

                Section(Modules.activity.title) {
                    if !activityEnabled {
                        Text("Module disabled").foregroundStyle(.secondary)
                    } else if let reading = model.reading {
                        HStack(spacing: 20) {
                            ActivityRings(
                                move: ratio(reading.moveKcal, reading.moveGoalKcal),
                                exercise: ratio(reading.exerciseMinutes, reading.exerciseGoalMinutes),
                                stand: ratio(reading.standHours, reading.standGoalHours)
                            )
                            .frame(width: 96, height: 96)
                            VStack(alignment: .leading, spacing: 8) {
                                RingRow(label: "Move", value: reading.moveKcal, goal: reading.moveGoalKcal, unit: "kcal", color: .moveRing)
                                RingRow(label: "Exercise", value: reading.exerciseMinutes, goal: reading.exerciseGoalMinutes, unit: "min", color: .exerciseRing)
                                RingRow(label: "Stand", value: reading.standHours, goal: reading.standGoalHours, unit: "hr", color: .standRing)
                            }
                        }
                        .padding(.vertical, 4)
                        Text(reading.date)
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                    } else {
                        // 没授权、或者手表当天还没同步过来，都是这一句
                        Text("No activity summary for today yet").foregroundStyle(.secondary)
                    }
                }

                Section(Modules.workouts.title) {
                    if !workoutsEnabled {
                        Text("Module disabled").foregroundStyle(.secondary)
                    } else if let error = model.workoutError {
                        Text(error).foregroundStyle(.secondary)
                    } else if model.workouts.isEmpty {
                        ContentUnavailableView(
                            "No Readable Workouts",
                            systemImage: "figure.run",
                            description: Text("Allow Health access and sync your completed workouts.")
                        )
                    } else {
                        ForEach(model.workouts) { workout in
                            LocalWorkoutRow(workout: workout)
                        }
                    }
                }

                if model.needsAuthorization {
                    Section {
                        Button("Allow Health Access", systemImage: "heart.text.square") {
                            Task { await model.authorize() }
                        }
                    }
                }
            }
            .navigationTitle("iPhone")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showingSettings = true }
                }
                // 这一页唯一的主操作，钉在右上角，窗口再窄也不进溢出菜单
                ToolbarItem(placement: .topBarPinnedTrailing) {
                    Button {
                        Task { await model.report(force: true) }
                    } label: {
                        if model.busy {
                            ProgressView()
                        } else {
                            Label("Report Now", systemImage: "arrow.up.circle.fill")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(model.busy)
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .navigationTransition(.crossFade)
            }
            .refreshable { await model.refresh() }
        }
        // 回前台的那次上报在 App 层（`HubForeground`），这里只负责把结果读回来
        .task { await model.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: .hubDidReport).receive(on: DispatchQueue.main)) { _ in
            Task { await model.refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            activityEnabled = HubSettings.isEnabled(Modules.activity.id)
            workoutsEnabled = HubSettings.isEnabled(Modules.workouts.id)
            Task { await model.refresh() }
        }
        .onChange(of: showingSettings) { _, showing in
            // 从设置退回来：开关可能变了，读数和下一次上报都要跟着走
            guard !showing else { return }
            activityEnabled = HubSettings.isEnabled(Modules.activity.id)
            workoutsEnabled = HubSettings.isEnabled(Modules.workouts.id)
            Task { await model.refresh() }
        }
    }

    private func ratio(_ value: Double, _ goal: Double) -> Double {
        goal > 0 ? value / goal : 0
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

private struct LocalWorkoutRow: View {
    let workout: WorkoutReading

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(workout.activityType, systemImage: WorkoutSymbols.symbol(for: workout.activityType))
                .font(.headline)
            if let indoor = workout.indoor {
                Text(indoor ? "Indoor" : "Outdoor").font(.caption).foregroundStyle(.secondary)
            }
            Text(Format.stamp(Date(epochMilliseconds: workout.startedAt), secondsFromGMT: workout.secondsFromGMT))
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text(Format.duration(seconds: workout.durationSeconds))
                if let distance = workout.distanceMeters { Text(Format.distance(meters: distance)) }
                if let energy = workout.activeEnergyKcal { Text("\(Format.integer(energy)) kcal") }
            }
            .font(.subheadline.monospacedDigit())
            if let heartRate = workout.averageHeartRateBpm {
                Text("Avg \(Format.integer(heartRate)) bpm")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
