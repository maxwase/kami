import KamiCore
import Testing

struct ClipperTests {
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
