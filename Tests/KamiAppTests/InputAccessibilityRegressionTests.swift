import ComposableArchitecture
import Foundation
import KamiCore
import Testing

@testable import KamiApp

@MainActor
struct InputAccessibilityRegressionTests {
    @Test("Finnish comma decimals and grouped thousands parse without lossy sentinels")
    func finnishDimensionsRoundTrip() {
        let locale = Locale(identifier: "fi_FI")

        #expect(PaperDimensionText.parse("210,5", locale: locale) == 210.5)
        #expect(PaperDimensionText.parse("1 000,5", locale: locale) == 1_000.5)
        #expect(PaperDimensionText.parse("not a number", locale: locale) == nil)
        #expect(PaperDimensionText.format(1_000.5, locale: locale) == "1 000,5")
    }

    @Test("Hardware shortcuts are unique and avoid reserved Command-F")
    func keyboardShortcutsAreConcreteAndNonReserved() throws {
        #expect(AppKeyboardCommand.fold.shortcut == AppKeyboardShortcut(
            key: "f",
            modifiers: [.command, .shift]
        ))
        #expect(AppKeyboardCommand.flip.shortcut == AppKeyboardShortcut(
            key: "l",
            modifiers: [.command, .shift]
        ))
        #expect(AppKeyboardCommand.reset.shortcut == AppKeyboardShortcut(
            key: "r",
            modifiers: [.command, .shift]
        ))
        #expect(Set(AppKeyboardCommand.allCases.map(\.shortcut)).count == 3)

        var state = AppFeature.State(paper: try accessiblePaper())
        #expect(state.keyboardCommandsEnabled)
        state.renderState = .flipping(try expectedKeyboardFlip(paper: state.paper))
        #expect(state.keyboardCommandsEnabled == false)
    }

    @Test("Canvas accessibility value exposes faces, side, and active progress")
    func canvasValueTracksRenderedState() async throws {
        let paper = try accessiblePaper()
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.faceIDGenerator = .incrementing(from: 10)
            $0.animationTimeline = AnimationTimeline(
                ticks: { _ in [] },
                endpointHold: .seconds(1)
            )
        }

        #expect(store.state.canvasAccessibilityValue == "1 face, front side, Ready")
        await store.send(.foldButtonTapped) {
            $0.renderState = .folding(try accessibleFold(progress: 0))
        }
        await store.send(.animationProgressed(0.5)) {
            $0.renderState = .folding(try accessibleFold(progress: 0.5))
        }
        #expect(store.state.canvasAccessibilityValue == "1 face, front side, Folding 50%")
        await store.send(.animationCancelled) {
            $0.renderState = .idle
        }
    }

    @Test("Rejected Fold is diagnosable and Reset clears stale validation")
    func rejectionAndResetQualityState() async throws {
        let emptyPaper = try Paper(
            id: PaperID(rawValue: 1),
            style: .white,
            center: .zero,
            rotation: 0,
            scale: 1,
            baseSize: .a4,
            faces: []
        )
        var settings = PaperSettings()
        settings.validationError = .invalidDimensions
        let store = TestStore(initialState: AppFeature.State(paper: emptyPaper, paperSettings: settings)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 40)
        }

        await store.send(.foldButtonTapped) {
            $0.foldRejection = .noIntersection
        }
        await store.send(.resetButtonTapped) {
            $0.paper = try Paper.rectangle(
                id: PaperID(rawValue: 1),
                faceID: FaceID(rawValue: 40),
                style: .white,
                center: .zero,
                width: 210,
                height: 297
            )
            $0.foldRejection = nil
            $0.paperSettings.validationError = nil
            $0.accessibilityAnnouncement = "Paper reset"
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: emptyPaper, paperSettings: settings),
            ])
        }
    }

    @Test("Completed changes expose a native accessibility announcement payload")
    func completionCreatesAccessibilityFeedback() async throws {
        let paper = try accessiblePaper()
        let store = TestStore(initialState: AppFeature.State(paper: paper, reduceMotionEnabled: true)) {
            AppFeature()
        }

        await store.send(.flipButtonTapped) {
            $0.paper = commitFlip(paper)
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: paper, paperSettings: PaperSettings()),
            ])
            $0.accessibilityAnnouncement = "Flip complete"
        }
        await store.send(.resetButtonTapped) {
            $0.paper = try Paper.rectangle(
                id: PaperID(rawValue: 1),
                faceID: FaceID(rawValue: 1),
                style: .white,
                center: .zero,
                width: 210,
                height: 297
            )
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: paper, paperSettings: PaperSettings()),
                AppPaperSnapshot(paper: commitFlip(paper), paperSettings: PaperSettings()),
            ])
            $0.accessibilityAnnouncement = "Paper reset"
        }
    }
}

private func expectedKeyboardFlip(paper: Paper) throws -> FoldAnimation {
    FoldAnimation(
        paperID: paper.id,
        line: try Line2D(point: .zero, direction: Point2D(x: 0, y: 1)),
        moving: .positive,
        stationaryFaces: [],
        movingFaces: paper.faces,
        foldedLayer: 1
    )
}

private func accessiblePaper() throws -> Paper {
    try Paper.rectangle(
        id: PaperID(rawValue: 1),
        faceID: FaceID(rawValue: 1),
        style: .white,
        center: .zero,
        width: 210,
        height: 297
    )
}

private func accessibleFold(progress: Double) throws -> FoldAnimation {
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
