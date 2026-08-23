import KamiCore

enum AppRenderState: Equatable, Sendable {
    case idle
    case folding(FoldAnimation)
    case flipping(FoldAnimation)

    var isAnimating: Bool {
        self != .idle
    }

    var rendererAnimation: FoldAnimation? {
        switch self {
        case .idle:
            nil
        case let .folding(animation), let .flipping(animation):
            animation
        }
    }
}
