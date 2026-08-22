import KamiCore
import Testing

struct FoldTests {
    @Test("A center fold creates a stationary face and a reflected top layer")
    func centerFoldCreatesTwoLayeredFaces() throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: .zero,
            width: 200,
            height: 100
        )
        let line = try Line2D(point: .zero, direction: Point2D(x: 0, y: 1))
        let folded = try paper.folding(FoldRequest(line: line, moving: .positive))

        #expect(folded.faces.count == 2)
        #expect(folded.faces.map(\.layer) == [0, 1])
        #expect(folded.faces.map(\.visibleSide) == [.front, .back])
        #expect(folded.faces[1].polygon.vertices.contains(Point2D(x: 100, y: -50)))
    }

    @Test("A fold outside the paper rejects without changing state")
    func nonIntersectingFoldIsRejected() throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1), faceID: FaceID(rawValue: 1), style: .white,
            center: .zero, width: 200, height: 100
        )
        let line = try Line2D(point: Point2D(x: 500, y: 0), direction: Point2D(x: 0, y: 1))

        #expect(throws: FoldRejection.noIntersection) {
            try paper.folding(FoldRequest(line: line, moving: .positive))
        }
    }
}
