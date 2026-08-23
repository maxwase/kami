import KamiCore

enum AppRenderState: Equatable, Sendable {
    case idle
    case folding(FoldAnimation)
    case flipping(progress: Double)

    var isAnimating: Bool {
        self != .idle
    }

    var foldAnimation: FoldAnimation? {
        guard case let .folding(animation) = self else { return nil }
        return animation
    }
}
