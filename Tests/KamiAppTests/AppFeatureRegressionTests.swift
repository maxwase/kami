import ComposableArchitecture
import KamiCore
import Testing

@testable import KamiApp

@MainActor
struct AppFeatureRegressionTests {
    @Test("A4 to Square to custom can Undo and Reset without desynchronizing size")
    func sizeUndoRestoresCompletePaperAndSettings() async throws {
        let original = try regressionPaper(width: 210, height: 297, faceID: 1)
        let store = TestStore(initialState: AppFeature.State(paper: original)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 10)
        }

        await store.send(.paperFormatChanged(.square)) {
            $0.paper = try regressionPaper(width: 1, height: 1, faceID: 10)
            $0.undoHistory = regressionHistory(original)
            $0.paperSettings.format = .square
            $0.paperSettings.customWidth = 210
            $0.paperSettings.customHeight = 297
        }
        await store.send(.customDimensionsChanged(width: 80, height: 120)) {
            $0.paper = try regressionPaper(width: 80, height: 120, faceID: 11)
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: original, paperSettings: PaperSettings()),
                AppPaperSnapshot(
                    paper: try regressionPaper(width: 1, height: 1, faceID: 10),
                    paperSettings: PaperSettings(format: .square)
                ),
            ])
            $0.paperSettings.format = .custom
            $0.paperSettings.customWidth = 80
            $0.paperSettings.customHeight = 120
        }
        await store.send(.undoButtonTapped) {
            $0.paper = try regressionPaper(width: 1, height: 1, faceID: 10)
            $0.undoHistory = regressionHistory(original)
            $0.paperSettings.format = .square
            $0.paperSettings.customWidth = 210
            $0.paperSettings.customHeight = 297
        }
        await store.send(.resetButtonTapped) {
            $0.paper = try regressionPaper(width: 1, height: 1, faceID: 12)
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: original, paperSettings: PaperSettings()),
                AppPaperSnapshot(
                    paper: try regressionPaper(width: 1, height: 1, faceID: 10),
                    paperSettings: PaperSettings(format: .square)
                ),
            ])
            $0.accessibilityAnnouncement = "Paper reset"
        }
    }

    @Test("Color changes and later mutations undo without paper/settings desynchronization")
    func colorAndSizeUndoAtomically() async throws {
        let original = try regressionPaper(width: 210, height: 297, faceID: 1)
        let coloredStyle = PaperStyle(frontColor: "#F4C7C3", backColor: "#BFD7EA", edgeColor: "#34353A")
        let colored = try regressionPaper(width: 210, height: 297, faceID: 1, style: coloredStyle)
        let store = TestStore(initialState: AppFeature.State(paper: original)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 20)
        }

        await store.send(.paperColorsChanged(coloredStyle)) {
            $0.undoHistory = regressionHistory(original)
            $0.paper = colored
            $0.paperSettings.frontColor = coloredStyle.frontColor
            $0.paperSettings.backColor = coloredStyle.backColor
            $0.paperSettings.edgeColor = coloredStyle.edgeColor
        }
        await store.send(.paperFormatChanged(.square)) {
            $0.paper = try regressionPaper(width: 1, height: 1, faceID: 20, style: coloredStyle)
            $0.undoHistory = AppUndoHistory(snapshots: [
                AppPaperSnapshot(paper: original, paperSettings: PaperSettings()),
                AppPaperSnapshot(paper: colored, paperSettings: regressionSettings(style: coloredStyle)),
            ])
            $0.paperSettings.format = .square
        }
        await store.send(.undoButtonTapped) {
            $0.paper = colored
            $0.undoHistory = regressionHistory(original)
            $0.paperSettings.format = .a4
        }
        await store.send(.undoButtonTapped) {
            $0.paper = original
            $0.undoHistory = AppUndoHistory()
            $0.paperSettings.frontColor = PaperStyle.white.frontColor
            $0.paperSettings.backColor = PaperStyle.white.backColor
            $0.paperSettings.edgeColor = PaperStyle.white.edgeColor
        }
    }

    @Test("Rejected custom preset does not consume a face identifier")
    func rejectedCustomPresetDoesNotConsumeID() async throws {
        let original = try regressionPaper(width: 210, height: 297, faceID: 1)
        var settings = PaperSettings()
        settings.customWidth = 0
        settings.customHeight = 120
        let store = TestStore(initialState: AppFeature.State(paper: original, paperSettings: settings)) {
            AppFeature()
        } withDependencies: {
            $0.faceIDGenerator = .incrementing(from: 30)
        }

        await store.send(.paperFormatChanged(.custom)) {
            $0.paperSettings.validationError = .invalidDimensions
        }
        await store.send(.customDimensionsChanged(width: 80, height: 120)) {
            $0.paper = try regressionPaper(width: 80, height: 120, faceID: 30)
            $0.undoHistory = regressionHistory(original, settings: settings)
            $0.paperSettings.format = .custom
            $0.paperSettings.customWidth = 80
            $0.paperSettings.customHeight = 120
            $0.paperSettings.validationError = nil
        }
    }
}

private func regressionPaper(
    width: Double,
    height: Double,
    faceID: UInt64,
    style: PaperStyle = .white
) throws -> Paper {
    try Paper.rectangle(
        id: PaperID(rawValue: 1),
        faceID: FaceID(rawValue: faceID),
        style: style,
        center: .zero,
        width: width,
        height: height
    )
}

private func regressionHistory(
    _ paper: Paper,
    settings: PaperSettings = PaperSettings()
) -> AppUndoHistory {
    AppUndoHistory(snapshots: [AppPaperSnapshot(paper: paper, paperSettings: settings)])
}

private func regressionSettings(style: PaperStyle) -> PaperSettings {
    PaperSettings(
        frontColor: style.frontColor,
        backColor: style.backColor,
        edgeColor: style.edgeColor
    )
}
