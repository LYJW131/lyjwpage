import Charts
import SwiftUI

/**
 最近 24 小时的跨域时间线，对应站点的 Pulse 卡。

 状态泳道（编码、听、看、玩）画成 Swift Charts 的区间条，读数泳道（token 速率、充电功率、步数）
 各画一张小图。在图上按住拖动选一个时刻（`chartXSelection`），下面列出那一刻每条泳道的状态，
 等于站点上的悬停。段与段之间的空隙是「不知道」，不画成空闲。
 */
struct PulseView: View {
    @Environment(LiveStore.self) private var store
    @State private var selection: Date?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let pulse = store.pulse {
                        StateLanesCard(pulse: pulse, selection: $selection)
                        ReadingsCard(pulse: pulse, selection: $selection)
                        // 放在两张图下面：拖动时插进来的明细不会把手指下的图顶走
                        if let selection {
                            MomentCard(pulse: pulse, at: selection)
                        }
                        SummaryCard(pulse: pulse)
                        DaySummaryCard(pulse: pulse)
                    } else {
                        ContentUnavailableView(
                            store.failure(.pulse) == nil ? "Loading" : "Pulse Unavailable",
                            systemImage: "waveform.path.ecg"
                        )
                        .padding(.top, 80)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .pageBackground()
            .navigationTitle("Pulse")
            .navigationSubtitle("Last 24 hours")
            .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
            .refreshable { await store.refresh([.pulse]) }
        }
    }
}

// MARK: 泳道

enum PulseLaneKind: String, CaseIterable, Identifiable {
    case coding = "Coding", listening = "Listening", watching = "Watching", gaming = "Gaming"

    var id: String { rawValue }

    var tint: Color {
        switch self {
        case .coding: .live
        case .listening: .pink
        case .watching: .indigo
        case .gaming: .blue
        }
    }
}

/// 一段画在图上的区间。`strength` 决定深浅：编码 3 档，听看玩 2 档
private struct LaneBar: Identifiable {
    let id: Int
    let lane: PulseLaneKind
    let start: Date
    let end: Date
    let strength: Double
}

private func bars(_ pulse: PulsePayload) -> [LaneBar] {
    var bars: [LaneBar] = []
    let window = pulse.window
    if let coding = pulse.lanes.coding {
        for segment in coding.segments where segment.value > 0 {
            // 1 只有前台应用、2 只有 agent、3 两者同时
            let strength = [0, 0.35, 0.65, 1][min(segment.value, 3)]
            bars.append(LaneBar(id: bars.count, lane: .coding, start: window.date(segment.startSec), end: window.date(segment.endSec), strength: strength))
        }
    }
    let stateLanes: [(PulseLaneKind, PulseStateLane?)] = [
        (.listening, pulse.lanes.listening), (.watching, pulse.lanes.watching), (.gaming, pulse.lanes.gaming),
    ]
    for (kind, lane) in stateLanes {
        for segment in lane?.segments ?? [] where segment.value.state > 0 {
            let strength = segment.value.state >= 2 ? 1 : 0.4
            bars.append(LaneBar(id: bars.count, lane: kind, start: window.date(segment.startSec), end: window.date(segment.endSec), strength: strength))
        }
    }
    return bars
}

private struct StateLanesCard: View {
    let pulse: PulsePayload
    @Binding var selection: Date?

    var body: some View {
        Card(title: "Timeline", systemImage: "chart.bar.xaxis") {
            Chart {
                ForEach(bars(pulse)) { bar in
                    RectangleMark(
                        xStart: .value("Start", bar.start),
                        xEnd: .value("End", bar.end),
                        y: .value("Lane", bar.lane.rawValue),
                        height: .ratio(0.62)
                    )
                    .foregroundStyle(bar.lane.tint.opacity(bar.strength))
                    .cornerRadius(3)
                }
                if let selection {
                    RuleMark(x: .value("Selected", selection))
                        .foregroundStyle(.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartXScale(domain: pulse.window.start...pulse.window.end)
            .chartYScale(domain: PulseLaneKind.allCases.map(\.rawValue))
            .chartXAxis {
                AxisMarks(values: .stride(by: .hour, count: 6)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.hour())
                }
            }
            .chartXSelection(value: $selection)
            .frame(height: 170)
        }
    }
}

private struct ReadingsCard: View {
    let pulse: PulsePayload
    @Binding var selection: Date?

    var body: some View {
        Card(title: "Readings", systemImage: "chart.xyaxis.line") {
            if let tokens = pulse.lanes.tokens, !tokens.buckets.isEmpty {
                reading("Tokens / min", tokens.currentPerMinute.map(Format.compact) ?? "—") {
                    ForEach(Array(tokens.buckets.enumerated()), id: \.offset) { _, bucket in
                        BarMark(
                            x: .value("Time", pulse.window.date(bucket.startSec)),
                            y: .value("Tokens", bucket.value.fresh + bucket.value.output)
                        )
                        .foregroundStyle(PulseLaneKind.coding.tint)
                    }
                }
            }
            if let charging = pulse.lanes.charging, !charging.segments.isEmpty {
                reading("Charging", charging.currentPowerW.map(Format.watts) ?? "Idle") {
                    ForEach(Array(charging.segments.enumerated()), id: \.offset) { _, segment in
                        RectangleMark(
                            xStart: .value("Start", pulse.window.date(segment.startSec)),
                            xEnd: .value("End", pulse.window.date(segment.endSec)),
                            yStart: .value("Zero", 0),
                            yEnd: .value("Watts", segment.value)
                        )
                        .foregroundStyle(Color.yellow.opacity(0.8))
                    }
                }
            }
            if let activity = pulse.lanes.activity, !activity.buckets.isEmpty {
                reading("Steps", Format.integer(activity.steps)) {
                    ForEach(Array(activity.buckets.enumerated()), id: \.offset) { _, bucket in
                        BarMark(
                            x: .value("Time", pulse.window.date(bucket.startSec)),
                            y: .value("Steps", bucket.value)
                        )
                        .foregroundStyle(Color.moveRing)
                    }
                }
            }
        }
    }

    private func reading<Marks: ChartContent>(_ title: String, _ value: String, @ChartContentBuilder marks: () -> Marks) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                Text(value).font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
            }
            Chart {
                marks()
                if let selection {
                    RuleMark(x: .value("Selected", selection))
                        .foregroundStyle(.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartXScale(domain: pulse.window.start...pulse.window.end)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartXSelection(value: $selection)
            .frame(height: 48)
        }
    }
}

/// 选中那一刻每条泳道在干什么
private struct MomentCard: View {
    let pulse: PulsePayload
    let at: Date

    var body: some View {
        let offset = at.timeIntervalSince(pulse.window.start)
        Card(title: at.formatted(.dateTime.hour().minute().locale(Format.locale)), systemImage: "clock") {
            row(.coding, Self.codingText(pulse.lanes.coding, offset))
            row(.listening, Self.stateText(pulse.lanes.listening, offset, active: "Playing"))
            row(.watching, Self.stateText(pulse.lanes.watching, offset, active: "Watching"))
            row(.gaming, Self.stateText(pulse.lanes.gaming, offset, active: "In game", idle: "Online"))
        }
    }

    private func row(_ lane: PulseLaneKind, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Circle().fill(lane.tint).frame(width: 8, height: 8)
            Text(lane.rawValue).font(.subheadline.weight(.medium)).frame(width: 84, alignment: .leading)
            Text(text).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private static func codingText(_ lane: PulseCodingLane?, _ offset: Double) -> String {
        guard let lane else { return "Unknown" }
        guard let segment = lane.segments.first(where: { $0.startSec <= offset && offset < $0.endSec }) else { return "Unknown" }
        return ["Idle", "App only", "Agent only", "App + agent"][min(segment.value, 3)]
    }

    private static func stateText(_ lane: PulseStateLane?, _ offset: Double, active: String, idle: String = "Paused") -> String {
        guard let lane else { return "Unknown" }
        guard let segment = lane.segments.first(where: { $0.startSec <= offset && offset < $0.endSec }) else { return "Unknown" }
        switch segment.value.state {
        case 2: return [active, segment.value.title, segment.value.subtitle].compactMap { $0 }.joined(separator: " · ")
        case 1: return [idle, segment.value.title].compactMap { $0 }.joined(separator: " · ")
        default: return "Idle"
        }
    }
}

private struct SummaryCard: View {
    let pulse: PulsePayload

    var body: some View {
        Card(title: "Totals", systemImage: "sum") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: 14) {
                if let coding = pulse.lanes.coding {
                    Metric(value: Format.duration(seconds: coding.humanSeconds + coding.agentSeconds + coding.bothSeconds), caption: "Coding")
                }
                if let tokens = pulse.lanes.tokens {
                    Metric(value: Format.compact(tokens.freshTokens), caption: "Fresh tokens")
                }
                if let listening = pulse.lanes.listening {
                    Metric(value: Format.duration(seconds: listening.activeSeconds), caption: "\(listening.titles) tracks")
                }
                if let watching = pulse.lanes.watching {
                    Metric(value: Format.duration(seconds: watching.activeSeconds), caption: "Watching")
                }
                if let gaming = pulse.lanes.gaming {
                    Metric(value: Format.duration(seconds: gaming.activeSeconds), caption: "In game")
                }
                if let charging = pulse.lanes.charging {
                    Metric(value: Format.decimal(charging.energyWh, digits: 1), unit: "Wh", caption: "Charged")
                }
                if let activity = pulse.lanes.activity {
                    Metric(value: Format.integer(activity.steps), caption: "Steps")
                }
            }
        }
    }
}
