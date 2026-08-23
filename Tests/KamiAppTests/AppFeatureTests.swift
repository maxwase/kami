import ComposableArchitecture
import KamiCore
import Testing

@testable import KamiApp

@MainActor
struct AppFeatureTests {
    @Test("Settings and info sheets are reducer-owned presentation state")
    func sheetPresentation() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        }

        await store.send(.settingsButtonTapped) {
            $0.presentedSheet = .settings
        }
        await store.send(.infoButtonTapped) {
            $0.presentedSheet = .info
        }
        await store.send(.sheetDismissed) {
            $0.presentedSheet = nil
        }
    }

    @Test("Primary controls are ignored while an animation is active")
    func controlsDoNotCorruptActiveAnimation() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let animation = try expectedFoldAnimation(progress: 0.5)
        let store = TestStore(initialState: AppFeature.State(
            paper: paper,
            renderState: .folding(animation)
        )) {
            AppFeature()
        }

        await store.send(.foldButtonTapped)
        await store.send(.flipButtonTapped)
        await store.send(.resetButtonTapped)
        await store.send(.undoButtonTapped)
    }

    @Test(
        "Keyboard commands route through active Fold, Flip, and Reset actions",
        arguments: [AppKeyboardCommand.fold, .flip, .reset]
    )
    func keyboardCommandsRoute(command: AppKeyboardCommand) async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.faceIDGenerator = .incrementing(from: 10)
        }

        await store.send(.keyboardCommand(command))
        switch command {
        case .fold:
            await store.receive(.foldButtonTapped) {
                $0.renderState = .folding(try expectedFoldAnimation(progress: 0))
            }
            await store.send(.animationCancelled) {
                $0.renderState = .idle
            }
        case .flip:
            await store.receive(.flipButtonTapped) {
                $0.renderState = .flipping(progress: 0)
            }
            await store.send(.animationCancelled) {
                $0.renderState = .idle
            }
        case .reset:
            await store.receive(.resetButtonTapped) {
                $0.paper = try Paper.rectangle(
                    id: PaperID(rawValue: 1),
                    faceID: FaceID(rawValue: 10),
                    style: .white,
                    center: Point2D(x: 0, y: 0),
                    width: 210,
                    height: 297
                )
                $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
            }
        }
    }

    @Test("Reduce Motion commits Flip without spatial animation")
    func reduceMotionCommitsFlipImmediately() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        }

        await store.send(.reduceMotionChanged(true)) {
            $0.reduceMotionEnabled = true
        }
        await store.send(.flipButtonTapped) {
            $0.paper = try expectedFlippedPaper()
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
        }
    }

    @Test("Reduce Motion commits Fold without progress effects")
    func reduceMotionCommitsFoldImmediately() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 10)
        }

        await store.send(.reduceMotionChanged(true)) {
            $0.reduceMotionEnabled = true
        }
        await store.send(.foldButtonTapped) {
            $0.paper = try expectedFoldedPaper()
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
        }
    }


    @Test("Outline and debug toggles remain reducer-owned renderer settings")
    func rendererTogglesUpdateSettings() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        }

        await store.send(.outlineChanged(false)) {
            $0.paperSettings.outlineEnabled = false
        }
        await store.send(.debugOverlayChanged(true)) {
            $0.paperSettings.debugOverlayEnabled = true
        }
    }

    @Test("Paper colors update both settings and immutable renderer input")
    func paperColorsUpdateStyle() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        }
        let style = PaperStyle(frontColor: "#FFF8E7", backColor: "#DCE8F2", edgeColor: "#49372A55")

        await store.send(.paperColorsChanged(style)) {
            $0.paper = try Paper(
                id: PaperID(rawValue: 1),
                style: style,
                center: Point2D(x: 0, y: 0),
                rotation: 0,
                scale: 1,
                baseSize: .a4,
                faces: paper.faces
            )
            $0.paperSettings.frontColor = "#FFF8E7"
            $0.paperSettings.backColor = "#DCE8F2"
            $0.paperSettings.edgeColor = "#49372A55"
        }
    }

    @Test("Square preset replaces the paper and remains undoable")
    func squareFormatReplacesPaper() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 70)
        }

        await store.send(.paperFormatChanged(.square)) {
            $0.paper = try Paper.rectangle(
                id: PaperID(rawValue: 1),
                faceID: FaceID(rawValue: 70),
                style: .white,
                center: Point2D(x: 0, y: 0),
                width: 1,
                height: 1
            )
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
            $0.paperSettings.format = .square
        }
    }

    @Test("Invalid custom dimensions are rejected without mutating paper")
    func invalidCustomDimensionsAreRejected() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        }

        await store.send(.customDimensionsChanged(width: 0, height: 100)) {
            $0.paperSettings.validationError = .invalidDimensions
        }
    }

    @Test("Valid custom dimensions replace the sheet with deterministic identity")
    func validCustomDimensionsReplacePaper() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 60)
        }

        await store.send(.customDimensionsChanged(width: 80, height: 120)) {
            $0.paper = try Paper.rectangle(
                id: PaperID(rawValue: 1),
                faceID: FaceID(rawValue: 60),
                style: .white,
                center: Point2D(x: 0, y: 0),
                width: 80,
                height: 120
            )
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
            $0.paperSettings.format = .custom
            $0.paperSettings.customWidth = 80
            $0.paperSettings.customHeight = 120
        }
    }


    @Test("Undo restores the latest immutable paper snapshot")
    func undoRestoresSnapshot() async throws {
        let original = try expectedFlippedPaper()
        let current = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 40),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let store = TestStore(initialState: AppFeature.State(
            paper: current,
            undoHistory: UndoHistory(snapshots: [PaperSnapshot(paper: original)])
        )) {
            AppFeature()
        }

        await store.send(.undoButtonTapped) {
            $0.paper = original
            $0.undoHistory = UndoHistory()
        }
    }

    @Test("Reset records the current paper and restores its initial sheet")
    func resetRecordsUndo() async throws {
        let paper = try expectedFlippedPaper()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 40)
        }

        await store.send(.resetButtonTapped) {
            $0.paper = try Paper.rectangle(
                id: PaperID(rawValue: 1),
                faceID: FaceID(rawValue: 40),
                style: .white,
                center: Point2D(x: 0, y: 0),
                width: 210,
                height: 297
            )
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
        }
    }

    @Test("Flip enters an animated render state before committing")
    func flipStartsAnimation() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
        }

        await store.send(.flipButtonTapped) {
            $0.renderState = .flipping(progress: 0)
        }
        await store.send(.animationCancelled) {
            $0.renderState = .idle
        }
    }

    @Test("Flip commits after its injected-clock animation and records undo")
    func flipCommitsAfterAnimation() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
        }

        await store.send(.flipButtonTapped) {
            $0.renderState = .flipping(progress: 0)
        }
        for progress in [0.25, 0.5, 0.75] {
            await clock.advance(by: .milliseconds(90))
            await store.receive(.animationProgressed(progress)) {
                $0.renderState = .flipping(progress: progress)
            }
        }
        await clock.advance(by: .milliseconds(90))
        await store.receive(.animationProgressed(1)) {
            $0.paper = try expectedFlippedPaper()
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
            $0.renderState = .idle
        }
    }

    @Test("Fold advances on the injected clock and commits exactly at completion")
    func foldTimingCommitsAndRecordsUndo() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.faceIDGenerator = .incrementing(from: 10)
        }

        await store.send(.foldButtonTapped) {
            $0.renderState = .folding(try expectedFoldAnimation(progress: 0))
        }
        for progress in [0.25, 0.5, 0.75] {
            await clock.advance(by: .milliseconds(115))
            await store.receive(.animationProgressed(progress)) {
                $0.renderState = .folding(try expectedFoldAnimation(progress: progress))
            }
        }
        await clock.advance(by: .milliseconds(115))
        await store.receive(.animationProgressed(1)) {
            $0.paper = try expectedFoldedPaper()
            $0.undoHistory = UndoHistory(snapshots: [PaperSnapshot(paper: paper)])
            $0.renderState = .idle
        }
    }

    @Test("Fold starts a deterministic center-fold animation")
    func foldStartsCenterAnimation() async throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        )
        let clock = TestClock()
        let store = TestStore(initialState: AppFeature.State(paper: paper)) {
            AppFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.faceIDGenerator = .incrementing(from: 10)
        }

        await store.send(.foldButtonTapped) {
            $0.renderState = .folding(
                FoldAnimation(
                    paperID: PaperID(rawValue: 1),
                    line: try Line2D(point: Point2D(x: 0, y: 0), direction: Point2D(x: 1, y: 0)),
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
            )
        }

        await store.send(.animationCancelled) {
            $0.renderState = .idle
        }
    }
}

private func expectedFoldAnimation(progress: Double) throws -> FoldAnimation {
    FoldAnimation(
        paperID: PaperID(rawValue: 1),
        progress: progress,
        line: try Line2D(point: Point2D(x: 0, y: 0), direction: Point2D(x: 1, y: 0)),
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

private func expectedFoldedPaper() throws -> Paper {
    try Paper(
        id: PaperID(rawValue: 1),
        style: .white,
        center: Point2D(x: 0, y: 0),
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

private func expectedFlippedPaper() throws -> Paper {
    try Paper(
        id: PaperID(rawValue: 1),
        style: .white,
        center: Point2D(x: 0, y: 0),
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
