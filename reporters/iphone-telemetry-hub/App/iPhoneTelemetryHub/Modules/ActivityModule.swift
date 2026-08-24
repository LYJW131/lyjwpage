import Foundation
import HealthKit

/**
 活动圆环模块：当天的三环（活动 / 锻炼 / 站立）加步数、距离、爬楼层数。

 三环的**目标值**是这个模块存在的理由 —— 它们只在 `HKActivitySummary` 里，只有原生
 App 读得到。第三方导出工具（Health Auto Export 之类）导的是 HealthKit 的样本，
 导不出目标，于是目标只能配成站点那侧的常量，手表上调一次就要改两份生产的配置。

 站点那边的契约见 `src/lib/types.ts` 的 `ActivityStatus`，字段名逐字对齐。
 */
final class ActivityModule: TelemetryModule {
    let id = "activity"
    let title = "活动圆环"

    private let store = HKHealthStore()

    /**
     观测这四个类型。

     三环各自的驱动样本 + 步数。`HKActivitySummaryType` 本身**不能观测**（它不是
     `HKSampleType`），所以观的是喂它的那几个样本类型，响了再回头查一次整份 summary。

     距离和爬楼不在其中：它们只是附加数字，跟着上面几个的节奏一起发就够了，
     单独观测只会多出几次唤醒。
     */
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

    /**
     只答得出「问没问过」，答不出「给没给」。

     HealthKit 故意不透露读权限的授权结果 —— 否则「这个 App 读不到你的心率数据」
     本身就是一条健康信息。所以真正的信号是 `snapshot()` 到底拿不拿得到东西，
     这个方法只用来决定界面上要不要再弹一次授权表单。
     */
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
        /**
         手表当天还没有 summary（刚过午夜、手表还没同步）时这一轮不发。

         站点校验目标值必须为正，硬发一份零目标只会换回一个 400。
         */
        guard let reading = try await todayRings(), reading.isUsable else { return nil }
        return AnyEncodable(reading.payload(extras: await extraCounts(for: reading)))
    }

    /// 界面上那一份读数，不上报，只显示
    func currentReading() async -> RingReading? {
        (try? await todayRings()) ?? nil
    }

    // MARK: - 观测

    /**
     **必须是 nonisolated 的**：`HKObserverQuery` 的 updateHandler 在 SDK 里标着
     `NS_SWIFT_SENDABLE`，而闭包如果是在隔离上下文里写的，它就带着那份隔离，
     Swift 6 会当场拒绝（"passing closure as a 'sending' parameter"）。
     */
    private nonisolated static func observe(
        store: HKHealthStore,
        onChange: @escaping @Sendable () async -> Void
    ) async {
        for type in observedTypes {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                let box = CompletionBox(call: completion)
                if let error {
                    NSLog("[activity] 观测出错 %@", error.localizedDescription)
                    // 出错也要交差，否则 HealthKit 会认为这次没送达
                    box.call()
                    return
                }
                Task {
                    await onChange()
                    /**
                     **必须等上报真的结束再交差。**

                     早调的话，系统认为这次投递处理完了、随时可以把实例挂起，上报就被
                     掐在半路；一次都不调的话更糟 —— HealthKit 退避几次之后就不再为
                     这个 App 唤醒了，表现是「装上那天好好的，过几天再也不更新」。
                     */
                    box.call()
                }
            }
            store.execute(query)

            do {
                try await store.enableBackgroundDelivery(for: type, frequency: .hourly)
            } catch {
                // 打不开只是「后台不再自动上报」，前台那条路照常，不该让 App 起不来
                NSLog("[activity] 后台投递没打开 %@", error.localizedDescription)
            }
        }
    }

    // MARK: - 取数

    /**
     今天那份 summary。

     查询回调里就把值抽成一个 `Sendable` 的结构再跨回来 —— `HKActivitySummary`
     是个类，直接从 continuation 里传出来在 Swift 6 下过不了并发检查。
     */
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

    /// 步数、距离、爬楼。取不到就是 nil，不是 0 —— 见 ActivityPayload 的注释
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
                // 出错和「今天一个样本都没有」都落到 nil。读授权被拒时 HealthKit 也是
                // 这个表现（不报错，只是查不到），分不出来，所以一律当成「没有这项」
                continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }
}

/**
 HealthKit 那个交差回调的盒子。

 `HKObserverQueryCompletionHandler` 在头文件里是个光秃秃的 `void(^)(void)`，**没有**
 标 Sendable，所以把它捎进 `Task` 里等上报跑完再调，Swift 6 会拦。可它本来就是给别的
 队列回调用的，这里显式跨过去 —— 换成「先交差再上报」倒是能编译，但那正是要避免的事。
 */
private struct CompletionBox: @unchecked Sendable {
    let call: HKObserverQueryCompletionHandler
}

/**
 发给站点的那一份，字段名和 `src/lib/types.ts` 的 `ActivityStatus` 逐字对齐。

 三环一律取整：手表上显示的就是整数，多带的小数只会让每次上报的字节都不一样，
 而站点那边 SWR 靠深比较决定要不要重渲染。

 三个选填项用 `Optional`：合成的 `Codable` 对可选属性走 `encodeIfPresent`，
 所以取不到时**整个字段不出现**，而不是发一个 0 —— 站点据此把「没有这项」
 （那一格不渲染）和「今天是 0」分开。
 */
struct ActivityPayload: Codable, Sendable, Equatable {
    /// 手表本地的那一天，YYYY-MM-DD。取自 summary 自己的 dateComponents
    let date: String
    /// 当前时区的 UTC 偏移，秒。和 Mac 上报器的时区模块同名同单位
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
}

struct ExtraCounts: Sendable {
    var steps: Double?
    var distanceMeters: Double?
    var flightsClimbed: Double?
}

/**
 从 `HKActivitySummary` 抽出来的那一份，`Sendable`。

 日期直接从 summary 自己的 `dateComponents` 拼，**不另拿 `Date()` 算**：午夜前后
 两者会差一天，而这份数据说的是哪一天正是站点唯一较真的东西。
 */
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

    /// 三个目标都得是正数，否则那不是一份能用的记录（站点也会这么判）
    var isUsable: Bool {
        moveGoalKcal > 0 && exerciseGoalMinutes > 0 && standGoalHours > 0
    }

    func payload(extras: ExtraCounts) -> ActivityPayload {
        ActivityPayload(
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
            flightsClimbed: extras.flightsClimbed.map { Int($0.rounded()) }
        )
    }
}
