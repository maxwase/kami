import KamiCore
import Testing

struct ClipperTests {
    @Test("Horizontal center fold preserves the web fixture halves")
    func horizontalCenterFoldPreservesFixtureHalves() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: -100, y: -50),
            Point2D(x: 100, y: -50),
            Point2D(x: 100, y: 50),
            Point2D(x: -100, y: 50),
        ])
        let line = try Line2D(point: .zero, direction: Point2D(x: 1, y: 0))

        let positive = polygon.clipped(to: line, keeping: .positive)
        let negative = polygon.clipped(to: line, keeping: .negative)

        #expect(positive.vertices == [
            Point2D(x: -100, y: 0),
            Point2D(x: 100, y: 0),
            Point2D(x: 100, y: 50),
            Point2D(x: -100, y: 50),
        ])
        #expect(negative.vertices == [
            Point2D(x: -100, y: -50),
            Point2D(x: 100, y: -50),
            Point2D(x: 100, y: 0),
            Point2D(x: -100, y: 0),
        ])
    }

    @Test("Polygon reports winding and includes boundary points in hit tests")
    func polygonReportsWindingAndIncludesBoundaryPointsInHitTests() throws {
        let clockwise = try Polygon(vertices: [
            Point2D(x: -1, y: -1),
            Point2D(x: -1, y: 1),
            Point2D(x: 1, y: 1),
            Point2D(x: 1, y: -1),
        ])
        let counterclockwise = try Polygon(vertices: clockwise.vertices.reversed())

        #expect(clockwise.winding == .clockwise)
        #expect(counterclockwise.winding == .counterclockwise)
        #expect(clockwise.contains(Point2D(x: 0, y: 0)))
        #expect(clockwise.contains(Point2D(x: 1, y: 0)))
        #expect(clockwise.contains(Point2D(x: 2, y: 0)) == false)
    }

    @Test("Duplicate vertices do not make outside points count as boundary points")
    func duplicateVerticesDoNotMakeOutsidePointsCountAsBoundaryPoints() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: 0, y: 0),
            Point2D(x: 2, y: 0),
            Point2D(x: 2, y: 0),
            Point2D(x: 2, y: 2),
            Point2D(x: 0, y: 2),
            Point2D(x: 0, y: 0),
        ])

        #expect(polygon.contains(Point2D(x: 2, y: 1)))
        #expect(polygon.contains(Point2D(x: 4, y: 1)) == false)
    }

    @Test("A short edge does not make a distant collinear point a boundary point")
    func shortEdgeDoesNotMakeDistantCollinearPointABoundaryPoint() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: 0, y: 0),
            Point2D(x: 0.001, y: 0),
            Point2D(x: 1, y: 1),
            Point2D(x: 0, y: 1),
        ])

        #expect(polygon.contains(Point2D(x: 0.0015, y: 0)) == false)
    }

    @Test("Geometry constructors reject non-finite coordinates with typed errors")
    func geometryConstructorsRejectNonFiniteCoordinatesWithTypedErrors() {
        #expect(throws: GeometryError.self) {
            try Line2D(
                point: Point2D(x: .nan, y: 0),
                direction: Point2D(x: 1, y: 0)
            )
        }
        #expect(throws: GeometryError.self) {
            try Line2D(
                point: .zero,
                direction: Point2D(x: .infinity, y: 0)
            )
        }
        #expect(throws: GeometryError.self) {
            try Polygon(vertices: [
                Point2D(x: 1, y: 0),
                Point2D(x: 0, y: .infinity),
                Point2D(x: -1, y: 0),
            ])
        }
    }

    @Test("Clipping a polygon wholly on one side returns an empty and unchanged half")
    func clippingPolygonWhollyOnOneSideReturnsEmptyAndUnchangedHalves() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: -1, y: -1),
            Point2D(x: 1, y: -1),
            Point2D(x: 1, y: 1),
            Point2D(x: -1, y: 1),
        ])
        let line = try Line2D(point: Point2D(x: 0, y: 2), direction: Point2D(x: 1, y: 0))

        #expect(polygon.clipped(to: line, keeping: .positive) == .empty)
        #expect(polygon.clipped(to: line, keeping: .negative) == polygon)
    }

    @Test("Clipping to a zero-area edge returns the empty polygon")
    func clippingToZeroAreaEdgeReturnsEmptyPolygon() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: -1, y: -1),
            Point2D(x: 1, y: -1),
            Point2D(x: 1, y: 1),
            Point2D(x: -1, y: 1),
        ])
        let line = try Line2D(point: Point2D(x: 0, y: 1), direction: Point2D(x: 1, y: 0))

        #expect(polygon.clipped(to: line, keeping: .positive) == .empty)
    }

    @Test(
        "Reflection across cardinal fold lines preserves the expected coordinate",
        arguments: [
            (
                linePoint: Point2D(x: 2, y: 0),
                direction: Point2D(x: 0, y: 1),
                point: Point2D(x: 5, y: 7),
                expected: Point2D(x: -1, y: 7)
            ),
            (
                linePoint: Point2D(x: 0, y: 3),
                direction: Point2D(x: 1, y: 0),
                point: Point2D(x: 5, y: 7),
                expected: Point2D(x: 5, y: -1)
            ),
        ]
    )
    func reflectionAcrossCardinalFoldLines(
        linePoint: Point2D,
        direction: Point2D,
        point: Point2D,
        expected: Point2D
    ) throws {
        let line = try Line2D(point: linePoint, direction: direction)

        #expect(line.reflected(point) == expected)
    }

    @Test("Degenerate geometry construction throws typed errors")
    func degenerateGeometryConstructionThrowsTypedErrors() {
        #expect(throws: GeometryError.degenerateLine) {
            try Line2D(point: .zero, direction: .zero)
        }
        #expect(throws: GeometryError.degeneratePolygon) {
            try Polygon(vertices: [
                Point2D(x: 0, y: 0),
                Point2D(x: 1, y: 0),
                Point2D(x: 2, y: 0),
            ])
        }
    }

    @Test("Vertical center fold preserves the web fixture halves")
    func verticalCenterFoldPreservesFixtureHalves() throws {
        let polygon = try Polygon(vertices: [
            Point2D(x: -100, y: -50),
            Point2D(x: 100, y: -50),
            Point2D(x: 100, y: 50),
            Point2D(x: -100, y: 50),
        ])
        let line = try Line2D(point: .zero, direction: Point2D(x: 0, y: 1))

        let positive = polygon.clipped(to: line, keeping: .positive)
        let negative = polygon.clipped(to: line, keeping: .negative)

        #expect(positive.vertices == [
            Point2D(x: -100, y: -50),
            Point2D(x: 0, y: -50),
            Point2D(x: 0, y: 50),
            Point2D(x: -100, y: 50),
        ])
        #expect(negative.vertices == [
            Point2D(x: 0, y: -50),
            Point2D(x: 100, y: -50),
            Point2D(x: 100, y: 50),
            Point2D(x: 0, y: 50),
        ])
    }
}
