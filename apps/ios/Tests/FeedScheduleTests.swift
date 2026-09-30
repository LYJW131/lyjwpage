import Foundation
import Testing
#if canImport(LyjwpageCore)
@testable import LyjwpageCore
#endif

/// 排期对着站点的 `src/lib/poll-schedule.ts`：App 打在 Worker 上的量不该比一个浏览器标签页多
@Suite struct FeedScheduleTests {
    private let now = Date(epochMilliseconds: 10_000_000)

    @Test func lagViewWaitsForNextExpectedWrite() {
        // 写入方 20 秒前写过、节奏 60 秒：再等 40 秒 + 15 秒宽限
        let delay = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 20_000, cadence: 60, now: now)
        #expect(delay == 55)
    }

    @Test func overdueLagViewBacksOffWithinCap() {
        // 按小时报的圆环一夜没报：封顶 5 分钟一取，不狂刷
        let overnight = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 10 * 3_600_000, cadence: 3600, now: now)
        #expect(overnight == 300)
        // 刚逾期：从 15 秒起步
        let justLate = FeedSchedule.lagDelay(updatedAt: now.epochMilliseconds - 76_000, cadence: 60, now: now)
        #expect(justLate == 15)
    }

    @Test func pushCoveredViewsFallBackToSafetyNetWhileLive() {
        let live = FeedSchedule.nextDue(for: .nowWatching, updatedAt: nil, socketLive: true, now: now)
        let offline = FeedSchedule.nextDue(for: .nowWatching, updatedAt: nil, socketLive: false, now: now)
        #expect(live.timeIntervalSince(now) == 300)
        #expect(offline.timeIntervalSince(now) == 60)
        // 靠心跳判活的不退：推送连着也照常轮询
        let charger = FeedSchedule.nextDue(for: .charger, updatedAt: nil, socketLive: true, now: now)
        #expect(charger.timeIntervalSince(now) == 30)
    }

    @Test func everyFeedHasAPath() {
        for key in FeedKey.allCases {
            #expect(key.path.hasPrefix("/api/"), "\(key) 的路径不对：\(key.path)")
        }
    }
}
