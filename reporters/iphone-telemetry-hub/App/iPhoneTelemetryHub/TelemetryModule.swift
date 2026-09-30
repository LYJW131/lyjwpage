import Foundation

protocol TelemetryModule: Sendable {
    var id: String { get }
    var title: String { get }

    func isAuthorized() async -> Bool
    func requestAuthorization() async throws

    func startObserving(onChange: @escaping @Sendable () async -> Void) async

    func snapshot() async throws -> AnyEncodable?
}

struct AnyEncodable: Encodable, Sendable {
    private let write: @Sendable (Encoder) throws -> Void

    init<T: Encodable & Sendable>(_ value: T) {
        write = { try value.encode(to: $0) }
    }

    func encode(to encoder: Encoder) throws {
        try write(encoder)
    }
}

struct TelemetryEnvelope: Encodable, Sendable {
    let version = 1
    let modules: [String: AnyEncodable]
}

enum Modules {
    static let activity = ActivityModule()

    static let workouts = WorkoutsModule()

    static let all: [any TelemetryModule] = [activity, workouts]
}
