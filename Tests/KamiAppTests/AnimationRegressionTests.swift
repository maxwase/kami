import ComposableArchitecture
import KamiCore
import Testing

@testable import KamiApp

@MainActor
struct AnimationRegressionTests {
    @Test("Live Flip timeline supplies display-cadence progress with an exact endpoint")
    func liveTimelineIsSmoothAndEndsExactly() {
        let ticks = AnimationTimeline.liveValue.ticks(.milliseconds(360))

        #expect(ticks.count == 22)
        #expect(ticks.first?.progress == 1.0 / 22.0)
        #expect(ticks.last?.progress == 1)
        #expect(ticks.reduce(Duration.zero) { $0 + $1.delay } == .milliseconds(360))
    }

    @Test("Flip renders its endpoint before committing without a reverse snap")
    func flipRendersEndpointThenCommits() async throws {
        let paper = try animationPaper()
        let clock = TestClock()
        let timeline = AnimationTimeline(
            ticks: { _ in [
                AnimationTick(delay: .milliseconds(100), progress: 0.5),
                AnimationTick(delay: .milliseconds(100), progress: 1),
            ] },
            endpointHold: .milliseconds(10)
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.animationTimeline = timeline
        }

        await store.send(.flipButtonTapped) {
            $0.renderState = .flipping(try expectedFlipAnimation(progress: 0))
        }
        await clock.advance(by: .milliseconds(100))
        await store.receive(.animationProgressed(0.5)) {
            $0.renderState = .flipping(try expectedFlipAnimation(progress: 0.5))
        }
        await clock.advance(by: .milliseconds(100))
        await store.receive(.animationProgressed(1)) {
            $0.renderState = .flipping(try expectedFlipAnimation(progress: 1))
        }
        #expect(store.state.paper == paper)

        await clock.advance(by: .milliseconds(10))
        await store.receive(.animationCompleted) {
            $0.paper = try animationFlippedPaper()
            $0.undoHistory = animationHistory(paper)
            $0.renderState = .idle
            $0.accessibilityAnnouncement = "Flip complete"
        }
    }

    @Test("Enabling Reduce Motion mid-Fold cancels and safely commits the endpoint")
    func reduceMotionFinishesActiveFold() async throws {
        let paper = try animationPaper()
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.faceIDGenerator = .incrementing(from: 10)
            $0.animationTimeline = .singleIntermediateFrame
        }

        await store.send(.foldButtonTapped) {
            $0.renderState = .folding(try expectedCenterFold(progress: 0))
        }
        await clock.advance(by: .milliseconds(100))
        await store.receive(.animationProgressed(0.5)) {
            $0.renderState = .folding(try expectedCenterFold(progress: 0.5))
        }
        await store.send(.reduceMotionChanged(true)) {
            $0.paper = try animationFoldedPaper()
            $0.undoHistory = animationHistory(paper)
            $0.renderState = .idle
            $0.reduceMotionEnabled = true
            $0.accessibilityAnnouncement = "Fold complete"
        }
    }

    @Test("Enabling Reduce Motion mid-Flip cancels and safely commits the endpoint")
    func reduceMotionFinishesActiveFlip() async throws {
        let paper = try animationPaper()
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.animationTimeline = .singleIntermediateFrame
        }

        await store.send(.flipButtonTapped) {
            $0.renderState = .flipping(try expectedFlipAnimation(progress: 0))
        }
        await clock.advance(by: .milliseconds(100))
        await store.receive(.animationProgressed(0.5)) {
            $0.renderState = .flipping(try expectedFlipAnimation(progress: 0.5))
        }
        await store.send(.reduceMotionChanged(true)) {
            $0.paper = try animationFlippedPaper()
            $0.undoHistory = animationHistory(paper)
            $0.renderState = .idle
            $0.reduceMotionEnabled = true
            $0.accessibilityAnnouncement = "Flip complete"
        }
    }
}

private extension AnimationTimeline {
    static let singleIntermediateFrame = Self(
        ticks: { _ in [
            AnimationTick(delay: .milliseconds(100), progress: 0.5),
            AnimationTick(delay: .milliseconds(100), progress: 1),
        ] },
        endpointHold: .milliseconds(10)
    )
}

private func animationPaper() throws -> Paper {
    try Paper.rectangle(
        id: PaperID(rawValue: 1),
        faceID: FaceID(rawValue: 1),
        style: .white,
        center: .zero,
        width: 210,
        height: 297
    )
}

private func expectedFlipAnimation(progress: Double) throws -> FoldAnimation {
    let paper = try animationPaper()
    return FoldAnimation(
        paperID: paper.id,
        duration: .milliseconds(360),
        progress: progress,
        line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
        moving: .positive,
        stationaryFaces: [],
        movingFaces: paper.faces,
        foldedLayer: 1
    )
}

private func expectedCenterFold(progress: Double) throws -> FoldAnimation {
    FoldAnimation(
        paperID: PaperID(rawValue: 1),
        progress: progress,
        line: try Line2D(point: .zero, direction: Point2D(x: 1, y: 0)),
        moving: .positive,
        stationaryFaces: [
            Face(
                id: FaceID(rawValue: 10),
                polygon: try Polygon(vertices: [
                    Point2D(x: -105, y: -148.5), Point2D(x: 105, y: -148.5),
                    Point2D(x: 105, y: 0), Point2D(x: -105, y: 0),
                ]),
                visibleSide: .front,
                layer: 0
            ),
        ],
        movingFaces: [
            Face(
                id: FaceID(rawValue: 11),
                polygon: try Polygon(vertices: [
                    Point2D(x: -105, y: 0), Point2D(x: 105, y: 0),
                    Point2D(x: 105, y: 148.5), Point2D(x: -105, y: 148.5),
                ]),
                visibleSide: .front,
                layer: 0
            ),
        ],
        foldedLayer: 1
    )
}

private func animationFoldedPaper() throws -> Paper {
    try Paper(
        id: PaperID(rawValue: 1),
        style: .white,
        center: .zero,
        rotation: 0,
        scale: 1,
        baseSize: .a4,
        faces: [
            Face(
                id: FaceID(rawValue: 10),
                polygon: try Polygon(vertices: [
                    Point2D(x: -105, y: -148.5), Point2D(x: 105, y: -148.5),
                    Point2D(x: 105, y: 0), Point2D(x: -105, y: 0),
                ]),
                visibleSide: .front,
                layer: 0
            ),
            Face(
                id: FaceID(rawValue: 12),
                polygon: try Polygon(vertices: [
                    Point2D(x: -105, y: 0), Point2D(x: 105, y: 0),
                    Point2D(x: 105, y: -148.5), Point2D(x: -105, y: -148.5),
                ]),
                visibleSide: .back,
                layer: 1
            ),
        ]
    )
}

private func animationFlippedPaper() throws -> Paper {
    try Paper(
        id: PaperID(rawValue: 1),
        style: .white,
        center: .zero,
        rotation: 0,
        scale: 1,
        baseSize: .a4,
        faces: [
            Face(
                id: FaceID(rawValue: 1),
                polygon: try Polygon(vertices: [
                    Point2D(x: 105, y: -148.5), Point2D(x: -105, y: -148.5),
                    Point2D(x: -105, y: 148.5), Point2D(x: 105, y: 148.5),
                ]),
                visibleSide: .back,
                layer: 0
            ),
        ]
    )
}

private func animationHistory(_ paper: Paper) -> AppUndoHistory {
    AppUndoHistory(snapshots: [AppPaperSnapshot(paper: paper, paperSettings: PaperSettings())])
}
