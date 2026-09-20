import Foundation
import HealthKit

/// Full recent-history snapshot: deletions are reflected on the next observer wake.
final class WorkoutsModule: TelemetryModule {
    let id = "workouts"
    let title = "Recent Workouts"
    private let store = HKHealthStore()
    private static let readTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(), HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling),
        HKQuantityType(.distanceSwimming), HKQuantityType(.distanceWheelchair),
        HKQuantityType(.distanceRowing), HKQuantityType(.distancePaddleSports),
        HKQuantityType(.distanceSkatingSports), HKQuantityType(.distanceDownhillSnowSports),
        HKQuantityType(.distanceCrossCountrySkiing),
    ]

    func isAuthorized() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        return (try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)) == .unnecessary
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    func startObserving(onChange: @escaping @Sendable () async -> Void) async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let type = HKObjectType.workoutType()
        let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
            let box = WorkoutCompletion(call: completion)
            guard error == nil else {
                NSLog("[workouts] Observer failed: %@", error!.localizedDescription)
                box.call()
                return
            }
            Task {
                await onChange()
                box.call()
            }
        }
        store.execute(query)
        do {
            try await store.enableBackgroundDelivery(for: type, frequency: .immediate)
        } catch {
            NSLog("[workouts] Background delivery failed: %@", error.localizedDescription)
        }
    }

    func snapshot() async throws -> AnyEncodable? {
        guard await isAuthorized() else { return nil }
        return AnyEncodable(WorkoutHistory(items: try await recentWorkouts()))
    }

    func recentWorkouts() async throws -> [WorkoutReading] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: HKQuery.predicateForSamples(withStart: nil, end: Date(), options: .strictEndDate),
                limit: 10,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            ) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                let workouts = samples as? [HKWorkout] ?? []
                continuation.resume(returning: workouts.map(WorkoutReading.init))
            }
            store.execute(query)
        }
    }
}

private struct WorkoutCompletion: @unchecked Sendable {
    let call: HKObserverQueryCompletionHandler
}

struct WorkoutHistory: Encodable, Sendable {
    let items: [WorkoutReading]
}

struct WorkoutReading: Encodable, Sendable, Identifiable {
    let id: String
    let activityType: String
    let startedAt: Double
    let endedAt: Double
    let secondsFromGMT: Int
    let durationSeconds: Double
    let distanceMeters: Double?
    let activeEnergyKcal: Double?
    let averageHeartRateBpm: Double?
    let maximumHeartRateBpm: Double?
    let elevationAscendedMeters: Double?
    let indoor: Bool?

    init(_ workout: HKWorkout) {
        id = workout.uuid.uuidString.lowercased()
        activityType = Self.name(workout.workoutActivityType)
        startedAt = (workout.startDate.timeIntervalSince1970 * 1000).rounded()
        endedAt = (workout.endDate.timeIntervalSince1970 * 1000).rounded()
        let zone = (workout.metadata?[HKMetadataKeyTimeZone] as? String).flatMap(TimeZone.init(identifier:)) ?? .current
        secondsFromGMT = zone.secondsFromGMT(for: workout.startDate)
        durationSeconds = workout.duration
        activeEnergyKcal = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        let heartRate = workout.statistics(for: HKQuantityType(.heartRate))
        let bpm = HKUnit.count().unitDivided(by: .minute())
        averageHeartRateBpm = heartRate?.averageQuantity()?.doubleValue(for: bpm)
        maximumHeartRateBpm = heartRate?.maximumQuantity()?.doubleValue(for: bpm)
        elevationAscendedMeters = (workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity)?.doubleValue(for: .meter())
        indoor = (workout.metadata?[HKMetadataKeyIndoorWorkout] as? NSNumber)?.boolValue
        // Read the distance statistic matching the workout, rather than adding unrelated distances.
        let distance: HKQuantityTypeIdentifier?
        switch workout.workoutActivityType {
        case .walking, .running, .hiking: distance = .distanceWalkingRunning
        case .cycling: distance = .distanceCycling
        case .swimming: distance = .distanceSwimming
        case .wheelchairWalkPace, .wheelchairRunPace: distance = .distanceWheelchair
        case .rowing: distance = .distanceRowing
        case .paddleSports: distance = .distancePaddleSports
        case .skatingSports: distance = .distanceSkatingSports
        case .downhillSkiing, .snowboarding: distance = .distanceDownhillSnowSports
        case .crossCountrySkiing: distance = .distanceCrossCountrySkiing
        default: distance = nil
        }
        distanceMeters = distance.flatMap { workout.statistics(for: HKQuantityType($0))?.sumQuantity()?.doubleValue(for: .meter()) }
    }

    private static func name(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .fencing: "Fencing"
        case .americanFootball: "American Football"
        case .archery: "Archery"
        case .australianFootball: "Australian Football"
        case .baseball: "Baseball"
        case .bowling: "Bowling"
        case .climbing: "Climbing"
        case .cricket: "Cricket"
        case .crossTraining: "Cross Training"
        case .curling: "Curling"
        case .danceInspiredTraining: "Dance Inspired Training"
        case .equestrianSports: "Equestrian Sports"
        case .fishing: "Fishing"
        case .golf: "Golf"
        case .gymnastics: "Gymnastics"
        case .handball: "Handball"
        case .hockey: "Hockey"
        case .hunting: "Hunting"
        case .lacrosse: "Lacrosse"
        case .mindAndBody: "Mind and Body"
        case .mixedMetabolicCardioTraining: "Mixed Metabolic Cardio"
        case .play: "Play"
        case .preparationAndRecovery: "Preparation and Recovery"
        case .racquetball: "Racquetball"
        case .rugby: "Rugby"
        case .sailing: "Sailing"
        case .snowSports: "Snow Sports"
        case .softball: "Softball"
        case .squash: "Squash"
        case .surfingSports: "Surfing"
        case .trackAndField: "Track and Field"
        case .volleyball: "Volleyball"
        case .waterFitness: "Water Fitness"
        case .waterPolo: "Water Polo"
        case .waterSports: "Water Sports"
        case .wrestling: "Wrestling"
        case .barre: "Barre"
        case .stairs: "Stairs"
        case .taiChi: "Tai Chi"
        case .handCycling: "Hand Cycling"
        case .discSports: "Disc Sports"
        case .fitnessGaming: "Fitness Gaming"
        case .pickleball: "Pickleball"
        case .swimBikeRun: "Swim Bike Run"
        case .transition: "Transition"
        case .underwaterDiving: "Underwater Diving"
        case .other: "Other Workout"
        case .walking: "Walking"
        case .running: "Running"
        case .cycling: "Cycling"
        case .swimming: "Swimming"
        case .hiking: "Hiking"
        case .traditionalStrengthTraining: "Strength Training"
        case .functionalStrengthTraining: "Functional Strength"
        case .highIntensityIntervalTraining: "HIIT"
        case .coreTraining: "Core Training"
        case .yoga: "Yoga"
        case .pilates: "Pilates"
        case .elliptical: "Elliptical"
        case .rowing: "Rowing"
        case .stairClimbing: "Stair Climbing"
        case .stepTraining: "Stair Step Training"
        case .dance, .cardioDance, .socialDance: "Dance"
        case .cooldown: "Cooldown"
        case .mixedCardio: "Mixed Cardio"
        case .badminton: "Badminton"
        case .tennis: "Tennis"
        case .tableTennis: "Table Tennis"
        case .basketball: "Basketball"
        case .soccer: "Soccer"
        case .jumpRope: "Jump Rope"
        case .kickboxing: "Kickboxing"
        case .boxing: "Boxing"
        case .martialArts: "Martial Arts"
        case .flexibility: "Flexibility"
        case .wheelchairWalkPace: "Wheelchair Walk Pace"
        case .wheelchairRunPace: "Wheelchair Run Pace"
        case .paddleSports: "Paddle Sports"
        case .skatingSports: "Skating"
        case .downhillSkiing: "Downhill Skiing"
        case .crossCountrySkiing: "Cross-Country Skiing"
        case .snowboarding: "Snowboarding"
        @unknown default: "Unknown Workout"
        }
    }
}
