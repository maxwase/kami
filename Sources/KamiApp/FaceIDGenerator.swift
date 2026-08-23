import ComposableArchitecture
import KamiCore

struct FaceIDGenerator: DependencyKey, Sendable {
    let next: @Sendable () -> FaceID

    func callAsFunction() -> FaceID {
        next()
    }

    static var liveValue: Self {
        incrementing(from: 10_000)
    }

    static var testValue: Self {
        incrementing(from: 1)
    }

    static func incrementing(from initialValue: UInt64) -> Self {
        let nextValue = LockIsolated(initialValue)
        return Self(next: {
            nextValue.withValue { value in
                defer { value &+= 1 }
                return FaceID(rawValue: value)
            }
        })
    }
}

extension DependencyValues {
    var faceIDGenerator: FaceIDGenerator {
        get { self[FaceIDGenerator.self] }
        set { self[FaceIDGenerator.self] = newValue }
    }
}
