import Foundation
import KamiCore
import Testing

struct FoldTests {
    @Test("A positive-side fold switches the moving faces to the back")
    func positiveSideFoldSwitchesMovingFaces() throws {
        let paper = try makeRectangle()
        let animation = try builtFold(
            paper: paper,
            line: Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive
        )

        #expect(animation.stationaryFaces.map(\.visibleSide) == [.front])
        #expect(animation.movingFaces.map(\.visibleSide) == [.front])

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 100))
        #expect(committed.faces.map(\.visibleSide) == [.front, .back])
    }

    @Test("A folded stack inverts moving layers")
    func foldInvertsMovingLayers() throws {
        let lower = try rectangleFace(id: 1, layer: 2)
        let upper = try rectangleFace(id: 2, layer: 7)
        let paper = try makePaper(faces: [lower, upper])
        let animation = try builtFold(
            paper: paper,
            line: Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive
        )

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 100))
        let movingLayers = committed.faces.filter { $0.visibleSide == .back }.map(\.layer).sorted()
        #expect(movingLayers == [8, 13])
    }

    @Test("A fold removes exact duplicate polygons only")
    func foldRemovesExactDuplicatePolygons() throws {
        let first = try rectangleFace(id: 1, layer: 0)
        let second = try rectangleFace(id: 2, layer: 0)
        let paper = try makePaper(faces: [first, second])
        let animation = try builtFold(
            paper: paper,
            line: Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive
        )

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 100))
        #expect(committed.faces.count == 2)
        #expect(committed.faces.map(\.visibleSide) == [.front, .back])
    }

    @Test("A fold retains polygons that are near but not exactly duplicate")
    func foldRetainsNearDuplicatePolygons() throws {
        let first = try rectangleFace(id: 1, layer: 0)
        let second = try rectangleFace(id: 2, layer: 0, centerX: 0.000_001)
        let paper = try makePaper(faces: [first, second])
        let animation = try builtFold(
            paper: paper,
            line: Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive
        )

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 100))

        #expect(committed.faces.count == 4)
    }

    @Test("A fold with no faces rejects as no intersection")
    func emptyPaperRejectsAsNoIntersection() throws {
        let paper = try makePaper(faces: [])
        let result = buildFold(
            paper: paper,
            request: FoldRequest(
                line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
                moving: .positive
            ),
            nextFaceID: faceIDs(startingAt: 10)
        )

        #expect(result.failure == .noIntersection)
    }

    @Test("A fold outside the paper rejects an empty stationary side")
    func foldOutsidePaperRejectsEmptyStationarySide() throws {
        let paper = try makeRectangle()
        var allocatedIDs = 0
        let result = buildFold(
            paper: paper,
            request: FoldRequest(
                line: try Line2D(point: Point2D(x: 500, y: 0), direction: Point2D(x: 0, y: 1)),
                moving: .positive
            ),
            nextFaceID: {
                allocatedIDs += 1
                return FaceID(rawValue: 10)
            }
        )

        #expect(result.failure == .emptyStationarySide)
        #expect(allocatedIDs == 0)
    }

    @Test("A fold outside the opposite side rejects an empty moving side")
    func foldOutsideOppositeSideRejectsEmptyMovingSide() throws {
        let paper = try makeRectangle()
        let result = buildFold(
            paper: paper,
            request: FoldRequest(
                line: try Line2D(point: Point2D(x: -500, y: 0), direction: Point2D(x: 0, y: 1)),
                moving: .positive
            ),
            nextFaceID: faceIDs(startingAt: 10)
        )

        #expect(result.failure == .emptyMovingSide)
    }

    @Test("Reset restores one front face and the initial transform")
    func resetRestoresInitialPaper() throws {
        let paper = try makePaper(
            center: Point2D(x: 15, y: -8),
            rotation: .pi / 3,
            scale: 2,
            faces: [try rectangleFace(id: 4, layer: 8, visibleSide: .back)]
        )

        let resetPaper = reset(paper, nextFaceID: faceIDs(startingAt: 30))

        #expect(resetPaper.rotation == 0)
        #expect(resetPaper.scale == 1)
        #expect(resetPaper.center == paper.center)
        #expect(resetPaper.faces.count == 1)
        #expect(resetPaper.faces[0].id == FaceID(rawValue: 30))
        #expect(resetPaper.faces[0].visibleSide == .front)
        #expect(resetPaper.faces[0].layer == 0)
    }

    @Test("Paper rejects layers that cannot be safely inverted")
    func paperRejectsUnsafeLayers() throws {
        let face = try rectangleFace(id: 1, layer: Int.max)

        #expect(throws: PaperValidationError.invalidLayer) {
            try makePaper(faces: [face])
        }
    }

    @Test("A fold animation normalizes non-finite progress")
    func foldAnimationNormalizesNonFiniteProgress() throws {
        let animation = FoldAnimation(
            paperID: PaperID(rawValue: 1),
            progress: .nan,
            line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive,
            stationaryFaces: [],
            movingFaces: [],
            foldedLayer: 0
        )

        #expect(animation.progress == 0)
    }

    @Test("A fold leaves paper intact when reflection becomes non-finite")
    func foldReflectionFailureIsAtomic() throws {
        let paper = try makeRectangle()
        let movingFace = try rectangleFace(id: 2, layer: 0)
        let animation = FoldAnimation(
            paperID: paper.id,
            line: try Line2D(point: Point2D(x: -1e308, y: 0), direction: Point2D(x: 0, y: 1)),
            moving: .positive,
            stationaryFaces: [],
            movingFaces: [movingFace],
            foldedLayer: 1
        )

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 10))

        #expect(committed == paper)
    }

    @Test("A fold animation for another paper leaves the requested paper unchanged")
    func foldAnimationForAnotherPaperIsRejected() throws {
        let source = try makeRectangle()
        let target = try Paper(
            id: PaperID(rawValue: 2),
            style: source.style,
            center: source.center,
            rotation: source.rotation,
            scale: source.scale,
            baseSize: source.baseSize,
            faces: source.faces
        )
        let animation = try builtFold(
            paper: source,
            line: Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive
        )
        var allocatedIDs = 0

        let committed = commitFold(target, animation: animation, nextFaceID: {
            allocatedIDs += 1
            return FaceID(rawValue: 10)
        })

        #expect(committed == target)
        #expect(allocatedIDs == 0)
    }

    @Test("A malformed fold animation cannot clear paper faces")
    func malformedFoldAnimationIsRejected() throws {
        let paper = try makeRectangle()
        let animation = FoldAnimation(
            paperID: paper.id,
            line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive,
            stationaryFaces: [],
            movingFaces: paper.faces,
            foldedLayer: 1
        )

        let committed = commitFold(paper, animation: animation, nextFaceID: faceIDs(startingAt: 10))

        #expect(committed == paper)
    }

    @Test("A fold animation with an empty polygon is rejected before allocating IDs")
    func foldAnimationWithEmptyPolygonIsRejected() throws {
        let paper = try makeRectangle()
        let emptyFace = Face(
            id: FaceID(rawValue: 99),
            polygon: .empty,
            visibleSide: .front,
            layer: 0
        )
        let animation = FoldAnimation(
            paperID: paper.id,
            line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
            moving: .positive,
            stationaryFaces: [emptyFace] + paper.faces,
            movingFaces: paper.faces,
            foldedLayer: 1
        )
        var allocatedIDs = 0

        let committed = commitFold(paper, animation: animation, nextFaceID: {
            allocatedIDs += 1
            return FaceID(rawValue: 10)
        })

        #expect(committed == paper)
        #expect(allocatedIDs == 0)
    }

    private func builtFold(paper: Paper, line: Line2D, moving: FoldSide) throws -> FoldAnimation {
        let result = buildFold(
            paper: paper,
            request: FoldRequest(line: line, moving: moving),
            nextFaceID: faceIDs(startingAt: 10)
        )
        return try #require(result.success)
    }
}

struct FlipTests {
    @Test("Flip reflects around the screen-vertical axis for a rotated paper")
    func flipUsesScreenVerticalAxisWhenPaperIsRotated() throws {
        let face = Face(
            id: FaceID(rawValue: 1),
            polygon: try Polygon(vertices: [
                Point2D(x: -10, y: -4), Point2D(x: 8, y: -4), Point2D(x: -3, y: 7),
            ]),
            visibleSide: .front,
            layer: 0
        )
        let paper = try makePaper(rotation: .pi / 2, faces: [face])

        let flipped = commitFlip(paper)

        #expect(pointsAreEqual(
            flipped.faces[0].polygon.vertices,
            [Point2D(x: -10, y: 7), Point2D(x: 8, y: 7), Point2D(x: -3, y: -4)]
        ))
        #expect(flipped.faces[0].visibleSide == .back)
    }

    @Test("Flip inverts the complete layer stack")
    func flipInvertsLayers() throws {
        let paper = try makePaper(faces: [
            try rectangleFace(id: 1, layer: 0),
            try rectangleFace(id: 2, layer: 4),
        ])

        let flipped = commitFlip(paper)

        #expect(flipped.faces.map(\.layer) == [4, 0])
        #expect(flipped.faces.map(\.visibleSide) == [.back, .back])
    }
}

struct UndoTests {
    @Test("Undo history is immutable and bounded")
    func historyIsImmutableAndBounded() throws {
        let original = try makeRectangle(center: .zero)
        let moved = try makeRectangle(center: Point2D(x: 10, y: 0))
        let rotated = try makeRectangle(center: Point2D(x: 10, y: 0), rotation: .pi / 4)
        let later = try makeRectangle(center: Point2D(x: 10, y: 0), rotation: .pi / 2)

        let empty = UndoHistory(capacity: 2)
        let once = empty.recording(original)
        let twice = once.recording(moved)
        let bounded = twice.recording(rotated)

        #expect(empty.snapshots.isEmpty)
        #expect(once.snapshots == [PaperSnapshot(paper: original)])
        #expect(bounded.snapshots == [PaperSnapshot(paper: moved), PaperSnapshot(paper: rotated)])

        let undone = try #require(bounded.undoing(from: later))
        #expect(undone.paper == rotated)
        #expect(undone.history.snapshots == [PaperSnapshot(paper: moved)])
    }

    @Test("Restoring applies a snapshot without changing paper identity or style")
    func restoringUsesSnapshotValues() throws {
        let original = try makeRectangle(center: Point2D(x: 4, y: 5), rotation: .pi / 8)
        let changed = try makeRectangle(center: Point2D(x: -2, y: 8), rotation: .pi / 2)

        let restored = restoring(changed, snapshot: PaperSnapshot(paper: original))

        #expect(restored.id == changed.id)
        #expect(restored.style == changed.style)
        #expect(restored.center == original.center)
        #expect(restored.rotation == original.rotation)
        #expect(restored.faces == original.faces)
    }
}

private func makeRectangle(
    center: Point2D = .zero,
    rotation: Double = 0,
    scale: Double = 1
) throws -> Paper {
    let initial = try Paper.rectangle(
        id: PaperID(rawValue: 1),
        faceID: FaceID(rawValue: 1),
        style: .white,
        center: center,
        width: 200,
        height: 100
    )
    return try Paper(
        id: initial.id,
        style: initial.style,
        center: center,
        rotation: rotation,
        scale: scale,
        baseSize: initial.baseSize,
        faces: initial.faces
    )
}

private func makePaper(
    center: Point2D = .zero,
    rotation: Double = 0,
    scale: Double = 1,
    faces: [Face]
) throws -> Paper {
    try Paper(
        id: PaperID(rawValue: 1),
        style: .white,
        center: center,
        rotation: rotation,
        scale: scale,
        baseSize: PaperAspectRatio(width: 200, height: 100),
        faces: faces
    )
}

private func rectangleFace(
    id: UInt64,
    layer: Int,
    visibleSide: PaperSide = .front,
    centerX: Double = 0
) throws -> Face {
    Face(
        id: FaceID(rawValue: id),
        polygon: try Polygon(vertices: [
            Point2D(x: centerX - 100, y: -50), Point2D(x: centerX + 100, y: -50),
            Point2D(x: centerX + 100, y: 50), Point2D(x: centerX - 100, y: 50),
        ]),
        visibleSide: visibleSide,
        layer: layer
    )
}

private func faceIDs(startingAt start: UInt64) -> () -> FaceID {
    var next = start
    return {
        defer { next += 1 }
        return FaceID(rawValue: next)
    }
}

private func pointsAreEqual(_ actual: [Point2D], _ expected: [Point2D], tolerance: Double = 0.000_001) -> Bool {
    guard actual.count == expected.count else { return false }
    return zip(actual, expected).allSatisfy { actualPoint, expectedPoint in
        abs(actualPoint.x - expectedPoint.x) <= tolerance
            && abs(actualPoint.y - expectedPoint.y) <= tolerance
    }
}

private extension Result where Success == FoldAnimation, Failure == FoldRejection {
    var success: FoldAnimation? {
        guard case let .success(animation) = self else { return nil }
        return animation
    }

    var failure: FoldRejection? {
        guard case let .failure(rejection) = self else { return nil }
        return rejection
    }
}
