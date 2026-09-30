import SwiftUI
#if canImport(FoundationModels)
import FoundationModels
#endif

struct DaySummaryCard: View {
    let pulse: PulsePayload
    @State private var summary: String?
    @State private var generating = false
    @State private var failure: String?

    var body: some View {
        #if canImport(FoundationModels)
        if case .available = SystemLanguageModel.default.availability {
            Card(title: "Day in Review", systemImage: "apple.intelligence") {
                if let summary {
                    Text(summary)
                        .font(.body)
                        .textSelection(.enabled)
                } else if let failure {
                    Text(failure).font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Text("A two-sentence recap of the last 24 hours, written on this iPhone.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Button {
                    Task { await generate() }
                } label: {
                    if generating {
                        ProgressView()
                    } else {
                        Label(summary == nil ? "Summarize" : "Rewrite", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.glassProminent)
                .disabled(generating)
            }
        }
        #endif
    }

    #if canImport(FoundationModels)
    private func generate() async {
        generating = true
        defer { generating = false }
        let facts = Self.facts(pulse)
        let session = LanguageModelSession {
            """
            You write a warm, specific two-sentence recap of someone's last 24 hours from their personal \
            telemetry. Use plain English, no lists, no emoji, no headings. Mention concrete titles when \
            given. Never invent activities that are not in the facts.
            """
        }
        do {
            let response = try await session.respond {
                "Facts about the last 24 hours:\n\(facts)"
            }
            summary = response.content
            failure = nil
        } catch {
            failure = "Couldn't write a summary right now."
        }
    }
    #endif

    static func facts(_ pulse: PulsePayload) -> String {
        var lines: [String] = []
        if let coding = pulse.lanes.coding {
            lines.append("Coding: \(Format.duration(seconds: coding.humanSeconds)) with only the editor, \(Format.duration(seconds: coding.agentSeconds)) with only AI agents, \(Format.duration(seconds: coding.bothSeconds)) with both.")
        }
        if let tokens = pulse.lanes.tokens {
            lines.append("AI tokens (fresh input + output): \(Format.compact(tokens.freshTokens)).")
        }
        for (name, lane) in [("Music", pulse.lanes.listening), ("TV and movies", pulse.lanes.watching), ("PlayStation", pulse.lanes.gaming)] {
            guard let lane, lane.activeSeconds > 0 else { continue }
            let titles = topTitles(lane)
            lines.append("\(name): \(Format.duration(seconds: lane.activeSeconds))" + (titles.isEmpty ? "." : ", mostly \(titles.joined(separator: ", "))."))
        }
        if let charging = pulse.lanes.charging, charging.energyWh > 0 {
            lines.append("Charged devices with \(Format.decimal(charging.energyWh, digits: 1)) Wh.")
        }
        if let activity = pulse.lanes.activity {
            let workouts = activity.workouts.map(\.value)
            lines.append("Walked \(Format.integer(activity.steps)) steps" + (workouts.isEmpty ? "." : "; workouts: \(workouts.joined(separator: ", "))."))
        }
        return lines.joined(separator: "\n")
    }

    private static func topTitles(_ lane: PulseStateLane) -> [String] {
        var seconds: [String: Double] = [:]
        for segment in lane.segments where segment.value.state >= 2 {
            guard let title = segment.value.title else { continue }
            seconds[title, default: 0] += segment.endSec - segment.startSec
        }
        return seconds.sorted { $0.value > $1.value }.prefix(3).map(\.key)
    }
}
