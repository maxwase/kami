import Foundation

public enum PolygonWinding: Equatable, Sendable {
    case clockwise
    case counterclockwise
}

public struct Polygon: Equatable, Sendable {
    public let vertices: [Point2D]

    public init(vertices: [Point2D]) throws {
        guard vertices.count >= 3, abs(Self.signedArea(vertices)) > GeometryTolerance.area else {
            throw GeometryError.degeneratePolygon
        }
        self.vertices = vertices
    }

    public static let empty = Polygon(uncheckedVertices: [])

    public var winding: PolygonWinding {
        Self.signedArea(vertices) < 0 ? .clockwise : .counterclockwise
    }

    public func contains(_ point: Point2D) -> Bool {
        guard vertices.count >= 3 else { return false }
        var isInside = false

        for index in vertices.indices {
            let start = vertices[index]
            let end = vertices[(index + 1) % vertices.count]
            if Self.isOnSegment(point, from: start, to: end) {
                return true
            }
            guard (start.y > point.y) != (end.y > point.y) else { continue }
            let intersectionX = (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x
            if point.x < intersectionX { isInside.toggle() }
        }
        return isInside
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

        return (try? Polygon(vertices: Self.canonicalized(output))) ?? .empty
    }

    private init(uncheckedVertices: [Point2D]) {
        vertices = uncheckedVertices
    }

    private static func intersection(_ start: Point2D, _ end: Point2D, _ startDistance: Double, _ endDistance: Double) -> Point2D {
        start + (end - start) * (startDistance / (startDistance - endDistance))
    }

    private static func isOnSegment(_ point: Point2D, from start: Point2D, to end: Point2D) -> Bool {
        let offset = point - start
        let edge = end - start
        let crossProduct = offset.x * edge.y - offset.y * edge.x
        guard abs(crossProduct) <= GeometryTolerance.distance else { return false }

        let dotProduct = offset.x * edge.x + offset.y * edge.y
        return dotProduct >= -GeometryTolerance.distance
            && dotProduct <= edge.x * edge.x + edge.y * edge.y + GeometryTolerance.distance
    }

    private static func canonicalized(_ vertices: [Point2D]) -> [Point2D] {
        let unique = vertices.reduce(into: [Point2D]()) { result, vertex in
            if result.last.map({ hypot($0.x - vertex.x, $0.y - vertex.y) > GeometryTolerance.distance }) ?? true {
                result.append(vertex)
            }
        }
        guard unique.count >= 3 else { return [] }
        let withoutClosingDuplicate = if let first = unique.first, let last = unique.last,
            hypot(first.x - last.x, first.y - last.y) <= GeometryTolerance.distance {
            Array(unique.dropLast())
        } else {
            unique
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
