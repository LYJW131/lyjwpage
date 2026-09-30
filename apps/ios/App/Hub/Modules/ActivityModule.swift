import Foundation
import HealthKit

final class ActivityModule: TelemetryModule {
    let id = "activity"
    let title = "Activity Rings"

    private let store = HKHealthStore()

    // HKActivitySummaryType 不是 HKSampleType，不能直接观测；必须观测驱动圆环的样本。
    private static let observedTypes: [HKSampleType] = [
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.appleExerciseTime),
        HKCategoryType(.appleStandHour),
        HKQuantityType(.stepCount),
    ]

    private static let readTypes: Set<HKObjectType> = [
        HKObjectType.activitySummaryType(),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.appleExerciseTime),
        HKCategoryType(.appleStandHour),
        HKQuantityType(.stepCount),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.flightsClimbed),
    ]

    // HealthKit 不透露读权限结果；unnecessary 只表示无需再次请求，不表示已获准读取。
    func isAuthorized() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)
        return status == .unnecessary
    }

    func requestAuthorization() async throws {
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    func startObserving(onChange: @escaping @Sendable () async -> Void) async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        await Self.observe(store: store, onChange: onChange)
    }

    func snapshot() async throws -> AnyEncodable? {
        guard HKHealthStore.isHealthDataAvailable() else { return nil }
        let history = try await recentHistory()
        guard let reading = try? await todayRings(), reading.isUsable else {
            // 圆环尚未同步也要把已经闭合的历史桶补上；接收端不会据此改写当前圆环。
            return AnyEncodable(ActivityHistoryOnlyPayload(history: history))
        }
        return AnyEncodable(reading.payload(extras: await extraCounts(for: reading), history: history))
    }

    func currentReading() async -> RingReading? {
        (try? await todayRings()) ?? nil
    }

    // HKObserverQuery 的回调是 NS_SWIFT_SENDABLE；隔离上下文会让闭包继承隔离，触发 Swift 并发检查。
    private nonisolated static func observe(
        store: HKHealthStore,
        onChange: @escaping @Sendable () async -> Void
    ) async {
        for type in observedTypes {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                let box = CompletionBox(call: completion)
                if let error {
                    NSLog("[activity] 观测出错 %@", error.localizedDescription)
                    // 出错也必须确认投递，否则 HealthKit 会退避后续唤醒。
                    box.call()
                    return
                }
                Task {
                    await onChange()
                    // 提前确认会允许系统挂起并截断上报；漏确认则会让 HealthKit 退避后续唤醒。
                    box.call()
                }
            }
            store.execute(query)

            do {
                try await store.enableBackgroundDelivery(for: type, frequency: .hourly)
            } catch {
                NSLog("[activity] 后台投递没打开 %@", error.localizedDescription)
            }
        }
    }

    // HKActivitySummary 不能跨隔离域传递，必须在查询回调内抽成 Sendable 值。
    private func todayRings() async throws -> RingReading? {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: Date())
        components.calendar = calendar
        let predicate = HKQuery.predicateForActivitySummary(with: components)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let summary = summaries?.first else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: RingReading(summary: summary, calendar: calendar))
            }
            store.execute(query)
        }
    }

    private func extraCounts(for reading: RingReading) async -> ExtraCounts {
        let start = reading.dayStart
        let end = min(Date(), start.addingTimeInterval(24 * 60 * 60))

        async let steps = sum(HKQuantityType(.stepCount), unit: .count(), start: start, end: end)
        async let distance = sum(HKQuantityType(.distanceWalkingRunning), unit: .meter(), start: start, end: end)
        async let flights = sum(HKQuantityType(.flightsClimbed), unit: .count(), start: start, end: end)

        return await ExtraCounts(steps: steps, distanceMeters: distance, flightsClimbed: flights)
    }

    private func sum(
        _ type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async -> Double? {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, _ in
                // HealthKit 拒绝读权限时同样只返回空结果，不能把读不到当作零。
                continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }

    // 每次都带完整 from/to，接收端按范围整体替换，HealthKit 修订或删除的旧桶才能被清掉。
    // 没有样本的桶不发送，站点会把那五分钟当作未知而不是静止。
    private func recentHistory(now: Date = Date()) async throws -> ActivityHistoryPayload {
        let bucketSeconds: TimeInterval = 5 * 60
        let to = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / bucketSeconds) * bucketSeconds)
        let from = to.addingTimeInterval(-24 * 60 * 60)

        async let move = bucketedSums(HKQuantityType(.activeEnergyBurned), unit: .kilocalorie(), from: from, to: to)
        async let exercise = bucketedSums(HKQuantityType(.appleExerciseTime), unit: .minute(), from: from, to: to)
        async let steps = bucketedSums(HKQuantityType(.stepCount), unit: .count(), from: from, to: to)
        let values = try await (move, exercise, steps)
        let starts = Set(values.0.keys).union(values.1.keys).union(values.2.keys).sorted()
        let buckets = starts.compactMap { start -> ActivityHistoryBucketPayload? in
            guard start >= epochMilliseconds(from), start < epochMilliseconds(to) else { return nil }
            return ActivityHistoryBucketPayload(
                from: start,
                to: start + Int64(bucketSeconds * 1_000),
                moveKcal: values.0[start],
                exerciseMinutes: values.1[start],
                steps: values.2[start]
            )
        }
        return ActivityHistoryPayload(
            from: epochMilliseconds(from),
            to: epochMilliseconds(to),
            buckets: buckets
        )
    }

    private func bucketedSums(
        _ type: HKQuantityType,
        unit: HKUnit,
        from: Date,
        to: Date
    ) async throws -> [Int64: Double] {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate),
            options: .cumulativeSum,
            anchorDate: Date(timeIntervalSince1970: 0),
            intervalComponents: DateComponents(minute: 5)
        )
        let collection = try await descriptor.result(for: store)
        var buckets: [Int64: Double] = [:]
        collection.enumerateStatistics(from: from, to: to) { statistics, _ in
            guard let quantity = statistics.sumQuantity() else { return }
            buckets[epochMilliseconds(statistics.startDate)] = quantity.doubleValue(for: unit)
        }
        return buckets
    }
}

private func epochMilliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1_000).rounded())
}

// SDK 的 completion 未标 Sendable，但必须跨队列等上报结束才能确认投递。
private struct CompletionBox: @unchecked Sendable {
    let call: HKObserverQueryCompletionHandler
}

struct ActivityReport: Codable, Sendable, Equatable {
    let date: String
    let secondsFromGMT: Int

    let moveKcal: Int
    let moveGoalKcal: Int
    let exerciseMinutes: Int
    let exerciseGoalMinutes: Int
    let standHours: Int
    let standGoalHours: Int

    let steps: Int?
    let distanceMeters: Int?
    let flightsClimbed: Int?
    let history: ActivityHistoryPayload
}

struct ActivityHistoryOnlyPayload: Codable, Sendable, Equatable {
    let history: ActivityHistoryPayload
}

struct ActivityHistoryPayload: Codable, Sendable, Equatable {
    let from: Int64
    let to: Int64
    let buckets: [ActivityHistoryBucketPayload]
}

struct ActivityHistoryBucketPayload: Codable, Sendable, Equatable {
    let from: Int64
    let to: Int64
    let moveKcal: Double?
    let exerciseMinutes: Double?
    let steps: Double?
}

struct ExtraCounts: Sendable {
    var steps: Double?
    var distanceMeters: Double?
    var flightsClimbed: Double?
}

// 日期必须取 summary 自身；午夜前后另取 Date() 可能把读数归到错误的一天。
struct RingReading: Sendable {
    let date: String
    let secondsFromGMT: Int
    let dayStart: Date

    let moveKcal: Double
    let moveGoalKcal: Double
    let exerciseMinutes: Double
    let exerciseGoalMinutes: Double
    let standHours: Double
    let standGoalHours: Double

    init(summary: HKActivitySummary, calendar: Calendar) {
        let parts = summary.dateComponents(for: calendar)
        date = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)

        let start = calendar.date(from: parts) ?? Date()
        dayStart = start
        secondsFromGMT = calendar.timeZone.secondsFromGMT(for: start)

        moveKcal = summary.activeEnergyBurned.doubleValue(for: .kilocalorie())
        moveGoalKcal = summary.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie())
        exerciseMinutes = summary.appleExerciseTime.doubleValue(for: .minute())
        exerciseGoalMinutes = summary.appleExerciseTimeGoal.doubleValue(for: .minute())
        standHours = summary.appleStandHours.doubleValue(for: .count())
        standGoalHours = summary.appleStandHoursGoal.doubleValue(for: .count())
    }

    // 站点拒收非正的目标值，硬发零目标只会换回 400。
    var isUsable: Bool {
        moveGoalKcal > 0 && exerciseGoalMinutes > 0 && standGoalHours > 0
    }

    func payload(extras: ExtraCounts, history: ActivityHistoryPayload) -> ActivityReport {
        ActivityReport(
            date: date,
            secondsFromGMT: secondsFromGMT,
            moveKcal: Int(moveKcal.rounded()),
            moveGoalKcal: Int(moveGoalKcal.rounded()),
            exerciseMinutes: Int(exerciseMinutes.rounded()),
            exerciseGoalMinutes: Int(exerciseGoalMinutes.rounded()),
            standHours: Int(standHours.rounded()),
            standGoalHours: Int(standGoalHours.rounded()),
            steps: extras.steps.map { Int($0.rounded()) },
            distanceMeters: extras.distanceMeters.map { Int($0.rounded()) },
            flightsClimbed: extras.flightsClimbed.map { Int($0.rounded()) },
            history: history
        )
    }
}
