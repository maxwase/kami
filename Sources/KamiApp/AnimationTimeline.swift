import ComposableArchitecture
import Foundation

struct AnimationTick: Equatable, Sendable {
    let delay: Duration
    let progress: Double
}

struct AnimationTimeline: DependencyKey, Sendable {
    let ticks: @Sendable (Duration) -> [AnimationTick]
    let endpointHold: Duration

    static let liveValue = Self(
        ticks: { duration in
            let components = duration.components
            let totalNanoseconds = max(
                0,
                components.seconds * 1_000_000_000 + Int64(components.attoseconds / 1_000_000_000)
            )
            let displayInterval = Int64(16_666_667)
            let frameCount = max(1, Int(ceil(Double(totalNanoseconds) / Double(displayInterval))))
            var elapsedNanoseconds: Int64 = 0
            return (1...frameCount).map { frame in
                let targetNanoseconds = totalNanoseconds * Int64(frame) / Int64(frameCount)
                defer { elapsedNanoseconds = targetNanoseconds }
                return AnimationTick(
                    delay: .nanoseconds(targetNanoseconds - elapsedNanoseconds),
                    progress: Double(frame) / Double(frameCount)
                )
            }
        },
        endpointHold: .nanoseconds(16_666_667)
    )

    static let testValue = liveValue
}

extension DependencyValues {
    var animationTimeline: AnimationTimeline {
        get { self[AnimationTimeline.self] }
        set { self[AnimationTimeline.self] = newValue }
    }
}
