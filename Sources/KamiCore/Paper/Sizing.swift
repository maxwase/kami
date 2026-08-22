import Foundation

public struct ViewportSize: Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

public struct PaperInsets: Equatable, Sendable {
    public let top: Double
    public let leading: Double
    public let bottom: Double
    public let trailing: Double

    public init(top: Double, leading: Double, bottom: Double, trailing: Double) {
        self.top = top
        self.leading = leading
        self.bottom = bottom
        self.trailing = trailing
    }

    public static let zero = Self(top: 0, leading: 0, bottom: 0, trailing: 0)
}

public struct PaperPlacement: Equatable, Sendable {
    public let center: Point2D
    public let size: Point2D

    public init(center: Point2D, size: Point2D) {
        self.center = center
        self.size = size
    }
}

public enum PaperSizingError: Error, Equatable, Sendable {
    case invalidViewport
    case invalidInsets
    case invalidMargin
    case insufficientAvailableSpace
}

public func paperPlacement(
    aspectRatio: PaperAspectRatio,
    in viewport: ViewportSize,
    safeArea: PaperInsets,
    margin: Double = 0
) throws -> PaperPlacement {
    guard viewport.width.isFinite, viewport.height.isFinite, viewport.width > 0, viewport.height > 0 else {
        throw PaperSizingError.invalidViewport
    }
    let insets = [safeArea.top, safeArea.leading, safeArea.bottom, safeArea.trailing]
    guard insets.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
        throw PaperSizingError.invalidInsets
    }
    guard margin.isFinite, margin >= 0 else { throw PaperSizingError.invalidMargin }

    let availableWidth = viewport.width - safeArea.leading - safeArea.trailing - 2 * margin
    let availableHeight = viewport.height - safeArea.top - safeArea.bottom - 2 * margin
    guard availableWidth > 0, availableHeight > 0 else { throw PaperSizingError.insufficientAvailableSpace }

    let fittedWidth = min(availableWidth, availableHeight * aspectRatio.value)
    let fittedHeight = fittedWidth / aspectRatio.value
    let center = Point2D(
        x: safeArea.leading + margin + availableWidth / 2,
        y: safeArea.top + margin + availableHeight / 2
    )
    return PaperPlacement(center: center, size: Point2D(x: fittedWidth, y: fittedHeight))
}
