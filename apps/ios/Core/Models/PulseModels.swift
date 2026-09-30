import Foundation

/**
 最近 24 小时的跨域时间线，`src/lib/types.ts#PulsePayload`。

 载荷是列式的：每条泳道是几列等长数组，时间是相对 `window.from` 的**秒**。这里在解码时
 就展开成一行一段，界面不用再对齐下标。段与段之间的空隙是「不知道」，不是「空闲」。

 每条泳道各自宽松解码：站点那侧的卡片也是丢掉畸形的那条、其余照画。
 */
struct PulsePayload: Decodable, Sendable, Equatable {
    let generatedAt: Double
    let window: PulseWindow
    let lanes: PulseLanes
}

struct PulseWindow: Decodable, Sendable, Equatable {
    let from: Double
    let to: Double

    var start: Date { Date(epochMilliseconds: from) }
    var end: Date { Date(epochMilliseconds: to) }

    func date(_ offsetSeconds: Double) -> Date {
        Date(epochMilliseconds: from + offsetSeconds * 1000)
    }
}

struct PulseLanes: Decodable, Sendable, Equatable {
    let coding: PulseCodingLane?
    let tokens: PulseTokensLane?
    let listening: PulseStateLane?
    let watching: PulseStateLane?
    let gaming: PulseStateLane?
    let charging: PulsePowerLane?
    let activity: PulseStepsLane?

    private enum CodingKeys: String, CodingKey {
        case coding, tokens, listening, watching, gaming, charging, activity
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        coding = try? container.decode(PulseCodingLane.self, forKey: .coding)
        tokens = try? container.decode(PulseTokensLane.self, forKey: .tokens)
        listening = try? container.decode(PulseStateLane.self, forKey: .listening)
        watching = try? container.decode(PulseStateLane.self, forKey: .watching)
        gaming = try? container.decode(PulseStateLane.self, forKey: .gaming)
        charging = try? container.decode(PulsePowerLane.self, forKey: .charging)
        activity = try? container.decode(PulseStepsLane.self, forKey: .activity)
    }
}

/// 一段区间，秒，相对 `window.from`
struct PulseSpan<Value: Sendable & Equatable>: Sendable, Equatable {
    let startSec: Double
    let endSec: Double
    let value: Value
}

/// 列不等长就是畸形，整条泳道作废
struct PulseColumnMismatch: Error {}

private func zipColumns<Value>(
    _ start: [Double],
    _ end: [Double],
    _ values: [Value]
) throws -> [PulseSpan<Value>] {
    guard start.count == end.count, end.count == values.count else { throw PulseColumnMismatch() }
    return values.indices.map { PulseSpan(startSec: start[$0], endSec: end[$0], value: values[$0]) }
}

/// 编码泳道的取值：0 都没有，1 只有前台应用，2 只有 agent，3 两者同时
struct PulseCodingLane: Decodable, Sendable, Equatable {
    let segments: [PulseSpan<Int>]
    let humanSeconds: Double
    let agentSeconds: Double
    let bothSeconds: Double

    private struct Columns: Decodable { let startSec: [Double]; let endSec: [Double]; let value: [Int] }
    private struct Summary: Decodable { let humanSeconds: Double; let agentSeconds: Double; let bothSeconds: Double }
    private struct Raw: Decodable { let segments: Columns; let summary: Summary }

    init(from decoder: Decoder) throws {
        let raw = try Raw(from: decoder)
        segments = try zipColumns(raw.segments.startSec, raw.segments.endSec, raw.segments.value)
        humanSeconds = raw.summary.humanSeconds
        agentSeconds = raw.summary.agentSeconds
        bothSeconds = raw.summary.bothSeconds
    }
}

struct PulseStateValue: Sendable, Equatable {
    /// 听 / 看：0 空闲、1 暂停、2 在放；玩：0 离线、1 在线、2 在游戏里
    let state: Int
    let title: String?
    let subtitle: String?
}

struct PulseStateLane: Decodable, Sendable, Equatable {
    let segments: [PulseSpan<PulseStateValue>]
    let activeSeconds: Double
    let titles: Int

    private struct Columns: Decodable {
        let startSec: [Double]; let endSec: [Double]; let state: [Int]
        let title: [String?]; let subtitle: [String?]
    }
    private struct Summary: Decodable { let activeSeconds: Double; let titles: Int }
    private struct Raw: Decodable { let segments: Columns; let summary: Summary }

    init(from decoder: Decoder) throws {
        let raw = try Raw(from: decoder)
        let columns = raw.segments
        guard columns.state.count == columns.title.count, columns.title.count == columns.subtitle.count else {
            throw PulseColumnMismatch()
        }
        let values = columns.state.indices.map {
            PulseStateValue(state: columns.state[$0], title: columns.title[$0], subtitle: columns.subtitle[$0])
        }
        segments = try zipColumns(columns.startSec, columns.endSec, values)
        activeSeconds = raw.summary.activeSeconds
        titles = raw.summary.titles
    }
}

struct PulsePowerLane: Decodable, Sendable, Equatable {
    /// 瓦
    let segments: [PulseSpan<Double>]
    let currentPowerW: Double?
    let peakW: Double?
    let energyWh: Double

    private struct Columns: Decodable { let startSec: [Double]; let endSec: [Double]; let watts: [Double] }
    private struct Summary: Decodable { let peakW: Double?; let energyWh: Double }
    private struct Raw: Decodable { let segments: Columns; let currentPowerW: Double?; let summary: Summary }

    init(from decoder: Decoder) throws {
        let raw = try Raw(from: decoder)
        segments = try zipColumns(raw.segments.startSec, raw.segments.endSec, raw.segments.watts)
        currentPowerW = raw.currentPowerW
        peakW = raw.summary.peakW
        energyWh = raw.summary.energyWh
    }
}

struct PulseStepsLane: Decodable, Sendable, Equatable {
    let buckets: [PulseSpan<Double>]
    let workouts: [PulseSpan<String>]
    let steps: Double

    private struct Buckets: Decodable { let startSec: [Double]; let endSec: [Double]; let steps: [Double] }
    private struct Workouts: Decodable { let startSec: [Double]; let endSec: [Double]; let activityType: [String] }
    private struct Summary: Decodable { let steps: Double }
    private struct Raw: Decodable { let buckets: Buckets; let workouts: Workouts; let summary: Summary }

    init(from decoder: Decoder) throws {
        let raw = try Raw(from: decoder)
        buckets = try zipColumns(raw.buckets.startSec, raw.buckets.endSec, raw.buckets.steps)
        workouts = try zipColumns(raw.workouts.startSec, raw.workouts.endSec, raw.workouts.activityType)
        steps = raw.summary.steps
    }
}

struct PulseTokenBucket: Sendable, Equatable {
    let fresh: Double
    let output: Double
    let cacheRead: Double
}

struct PulseTokensLane: Decodable, Sendable, Equatable {
    let buckets: [PulseSpan<PulseTokenBucket>]
    let peakPerMinute: Double?
    let currentPerMinute: Double?
    let freshTokens: Double

    private struct Columns: Decodable {
        let startSec: [Double]; let endSec: [Double]
        let fresh: [Double]; let output: [Double]; let cacheRead: [Double]
    }
    private struct Summary: Decodable { let peakPerMinute: Double?; let currentPerMinute: Double?; let freshTokens: Double }
    private struct Raw: Decodable { let buckets: Columns; let summary: Summary }

    init(from decoder: Decoder) throws {
        let raw = try Raw(from: decoder)
        let columns = raw.buckets
        guard columns.fresh.count == columns.output.count, columns.output.count == columns.cacheRead.count else {
            throw PulseColumnMismatch()
        }
        let values = columns.fresh.indices.map {
            PulseTokenBucket(fresh: columns.fresh[$0], output: columns.output[$0], cacheRead: columns.cacheRead[$0])
        }
        buckets = try zipColumns(columns.startSec, columns.endSec, values)
        peakPerMinute = raw.summary.peakPerMinute
        currentPerMinute = raw.summary.currentPerMinute
        freshTokens = raw.summary.freshTokens
    }
}
