import Foundation

public struct Point2D: Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public static let zero = Point2D(x: 0, y: 0)

    static func - (lhs: Self, rhs: Self) -> Self {
        Self(x: lhs.x - rhs.x, y: lhs.y - rhs.y)
    }

    static func + (lhs: Self, rhs: Self) -> Self {
        Self(x: lhs.x + rhs.x, y: lhs.y + rhs.y)
    }

    static func * (lhs: Self, rhs: Double) -> Self {
        Self(x: lhs.x * rhs, y: lhs.y * rhs)
    }

    var length: Double { hypot(x, y) }
    var normalized: Self? {
        guard length > GeometryTolerance.distance else { return nil }
        return self * (1 / length)
    }
}

public enum GeometryError: Error, Equatable, Sendable {
    case degenerateLine
    case degeneratePolygon
}

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
        self.normal = Point2D(x: -normalizedDirection.y, y: normalizedDirection.x)
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

    fileprivate var multiplier: Double { self == .positive ? 1 : -1 }
}

public struct Polygon: Equatable, Sendable {
    public let vertices: [Point2D]

    public init(vertices: [Point2D]) throws {
        guard vertices.count >= 3, abs(Self.signedArea(vertices)) > GeometryTolerance.area else {
            throw GeometryError.degeneratePolygon
        }
        self.vertices = vertices
    }

    public func clipped(to line: Line2D, keeping halfPlane: HalfPlane) -> Polygon {
        guard vertices.count >= 3 else { return self }
        var output: [Point2D] = []

        for index in vertices.indices {
            let start = vertices[index]
            let end = vertices[(index + 1) % vertices.count]
            let startDistance = line.signedDistance(to: start) * halfPlane.multiplier
            let endDistance = line.signedDistance(to: end) * halfPlane.multiplier
            let startInside = startDistance >= -GeometryTolerance.distance
            let endInside = endDistance >= -GeometryTolerance.distance

            switch (startInside, endInside) {
            case (true, true): output.append(end)
            case (true, false): output.append(Self.intersection(start, end, startDistance, endDistance))
            case (false, true):
                output.append(Self.intersection(start, end, startDistance, endDistance))
                output.append(end)
            case (false, false): break
            }
        }

        let cleaned = Self.canonicalized(output)
        return (try? Polygon(vertices: cleaned)) ?? Self.empty
    }

    public static let empty = Polygon(uncheckedVertices: [])

    private init(uncheckedVertices: [Point2D]) {
        vertices = uncheckedVertices
    }

    private static func intersection(_ start: Point2D, _ end: Point2D, _ startDistance: Double, _ endDistance: Double) -> Point2D {
        let fraction = startDistance / (startDistance - endDistance)
        return start + (end - start) * fraction
    }

    private static func canonicalized(_ vertices: [Point2D]) -> [Point2D] {
        let unique = vertices.reduce(into: [Point2D]()) { result, vertex in
            if result.last.map({ hypot($0.x - vertex.x, $0.y - vertex.y) > GeometryTolerance.distance }) ?? true {
                result.append(vertex)
            }
        }
        guard unique.count >= 3 else { return [] }
        let withoutClosingDuplicate: [Point2D]
        if let first = unique.first, let last = unique.last,
           hypot(first.x - last.x, first.y - last.y) <= GeometryTolerance.distance {
            withoutClosingDuplicate = Array(unique.dropLast())
        } else {
            withoutClosingDuplicate = unique
        }
        guard let start = withoutClosingDuplicate.indices.min(by: {
            withoutClosingDuplicate[$0].y == withoutClosingDuplicate[$1].y
                ? withoutClosingDuplicate[$0].x < withoutClosingDuplicate[$1].x
                : withoutClosingDuplicate[$0].y < withoutClosingDuplicate[$1].y
        }) else { return [] }
        return Array(withoutClosingDuplicate[start...]) + Array(withoutClosingDuplicate[..<start])
    }

    private static func signedArea(_ vertices: [Point2D]) -> Double {
        guard vertices.count >= 3 else { return 0 }
        return vertices.indices.reduce(into: 0.0) { area, index in
            let next = vertices[(index + 1) % vertices.count]
            area += vertices[index].x * next.y - next.x * vertices[index].y
        } / 2
    }
}

private enum GeometryTolerance {
    static let distance = 0.000_001
    static let area = 0.000_001
}
