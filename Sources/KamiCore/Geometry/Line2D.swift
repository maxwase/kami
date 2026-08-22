public struct Line2D: Equatable, Sendable {
    public let point: Point2D
    public let direction: Point2D
    public let normal: Point2D

    public init(point: Point2D, direction: Point2D) throws {
        guard let normalizedDirection = direction.normalized else {
            throw GeometryError.degenerateLine
        }
        self.point = point
        self.direction = normalizedDirection
        normal = Point2D(x: -normalizedDirection.y, y: normalizedDirection.x)
    }

    public func signedDistance(to point: Point2D) -> Double {
        let offset = point - self.point
        return offset.x * normal.x + offset.y * normal.y
    }

    public func reflected(_ point: Point2D) -> Point2D {
        point - normal * (2 * signedDistance(to: point))
    }
}

public enum HalfPlane: Sendable {
    case positive
    case negative

    var multiplier: Double { self == .positive ? 1 : -1 }
}
