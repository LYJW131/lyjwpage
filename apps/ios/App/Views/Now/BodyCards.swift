import Charts
import SwiftUI

// 读站点那份而不是本机 HealthKit：App 里看到的应当就是访客看到的
struct ActivityCard: View {
    @Environment(LiveStore.self) private var store
    let now: Date

    var body: some View {
        Card(title: "Activity", systemImage: "figure.walk", status: status) {
            if let activity = store.activity, !store.activityIsStale(now: now) {
                HStack(spacing: 18) {
                    ActivityRings(
                        move: ratio(activity.moveKcal, activity.moveGoalKcal),
                        exercise: ratio(activity.exerciseMinutes, activity.exerciseGoalMinutes),
                        stand: ratio(activity.standHours, activity.standGoalHours)
                    )
                    .frame(width: 104, height: 104)
                    .opacity(activity.currentAtSource ? 1 : 0.45)

                    VStack(alignment: .leading, spacing: 8) {
                        RingLine(color: .moveRing, value: activity.moveKcal, goal: activity.moveGoalKcal, unit: "kcal")
                        RingLine(color: .exerciseRing, value: activity.exerciseMinutes, goal: activity.exerciseGoalMinutes, unit: "min")
                        RingLine(color: .standRing, value: activity.standHours, goal: activity.standGoalHours, unit: "hr")
                    }
                }
                .fontDesign(.rounded)

                let extras = extraMetrics(activity)
                if !extras.isEmpty {
                    HStack(spacing: 20) {
                        ForEach(extras, id: \.caption) { metric in
                            Metric(value: metric.value, unit: metric.unit, caption: metric.caption)
                        }
                    }
                }
            } else {
                CardPlaceholder(text: "Unavailable")
            }

            if let workouts = store.workouts?.items, !workouts.isEmpty {
                Divider()
                WorkoutsStrip(workouts: Array(workouts.prefix(6)))
            }
        }
    }

    private var status: CardStatus {
        guard let activity = store.activity, !store.activityIsStale(now: now) else { return .unavailable }
        return activity.currentAtSource ? .stale(Date(epochMilliseconds: activity.pushedAt)) : .text(activity.date)
    }

    private func ratio(_ value: Double, _ goal: Double) -> Double {
        goal > 0 ? value / goal : 0
    }

    private struct Extra { let value: String; let unit: String?; let caption: String }

    // 选填的三项取不到就不画那一格，不当成 0
    private func extraMetrics(_ activity: ActivityPayload) -> [Extra] {
        var extras: [Extra] = []
        if let steps = activity.steps { extras.append(Extra(value: Format.integer(steps), unit: nil, caption: "Steps")) }
        if let meters = activity.distanceMeters {
            extras.append(Extra(value: Format.decimal(meters / 1000, digits: 2), unit: "km", caption: "Distance"))
        }
        if let flights = activity.flightsClimbed { extras.append(Extra(value: Format.integer(flights), unit: nil, caption: "Flights")) }
        return extras
    }
}

private struct RingLine: View {
    let color: Color
    let value: Double
    let goal: Double
    let unit: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(Format.integer(value))
                .font(.title3.weight(.semibold))
                .foregroundStyle(color)
                .contentTransition(.numericText(value: value))
            Text("/ \(Format.integer(goal)) \(unit)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .monospacedDigit()
    }
}

struct WorkoutsStrip: View {
    let workouts: [Workout]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(workouts) { workout in
                    WorkoutTile(workout: workout)
                        .containerRelativeFrame(.horizontal, count: 2, spacing: 10)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
    }
}

struct WorkoutTile: View {
    let workout: Workout

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(workout.activityType, systemImage: WorkoutSymbols.symbol(for: workout.activityType))
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text(Format.stamp(Date(epochMilliseconds: workout.startedAt), secondsFromGMT: workout.secondsFromGMT))
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Text(Format.duration(seconds: workout.durationSeconds))
                if let kcal = workout.activeEnergyKcal { Text("\(Format.integer(kcal)) kcal") }
                if let meters = workout.distanceMeters { Text(Format.distance(meters: meters)) }
            }
            .font(.caption.weight(.medium))
            .monospacedDigit()
            if let bpm = workout.averageHeartRateBpm {
                Label("\(Format.integer(bpm)) bpm", systemImage: "heart.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .symbolRenderingMode(.multicolor)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

// 键是 `WorkoutsModule` 上报的那套英文训练类型名
enum WorkoutSymbols {
    static func symbol(for type: String) -> String {
        switch type {
        case "Running": "figure.run"
        case "Walking": "figure.walk"
        case "Hiking": "figure.hiking"
        case "Cycling": "figure.outdoor.cycle"
        case "Swimming": "figure.pool.swim"
        case "Yoga": "figure.yoga"
        case "HIIT": "figure.highintensity.intervaltraining"
        case "Strength Training", "Functional Strength": "figure.strengthtraining.traditional"
        case "Core Training": "figure.core.training"
        case "Fencing": "figure.fencing"
        case "Elliptical": "figure.elliptical"
        case "Rowing": "figure.rower"
        case "Dance": "figure.dance"
        case "Badminton": "figure.badminton"
        case "Tennis": "figure.tennis"
        case "Table Tennis": "figure.table.tennis"
        case "Basketball": "figure.basketball"
        case "Soccer": "figure.soccer"
        case "Pilates": "figure.pilates"
        case "Stair Climbing", "Stairs": "figure.stairs"
        case "Jump Rope": "figure.jumprope"
        case "Boxing", "Kickboxing": "figure.boxing"
        case "Cooldown": "figure.cooldown"
        case "Mind and Body", "Tai Chi": "figure.mind.and.body"
        default: "figure.mixed.cardio"
        }
    }
}

struct PowerSparkline: View {
    let samples: [ChargerSample]

    var body: some View {
        if samples.count > 1 {
            Chart(samples, id: \.t) { sample in
                AreaMark(
                    x: .value("Time", Date(epochMilliseconds: sample.t)),
                    y: .value("Power", sample.w)
                )
                .foregroundStyle(.linearGradient(colors: [Color.live.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom))
                LineMark(
                    x: .value("Time", Date(epochMilliseconds: sample.t)),
                    y: .value("Power", sample.w)
                )
                .foregroundStyle(Color.live)
                .interpolationMethod(.monotone)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
        } else {
            Rectangle().fill(.clear)
        }
    }
}
