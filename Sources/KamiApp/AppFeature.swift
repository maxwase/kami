import ComposableArchitecture
import Foundation
import KamiCore

@Reducer
struct AppFeature {
    @ObservableState
    struct State: Equatable {
        var paper: Paper
        var undoHistory: UndoHistory
        var renderState: AppRenderState
        var paperSettings: PaperSettings
        var reduceMotionEnabled: Bool
        var presentedSheet: AppSheet?

        init(
            paper: Paper,
            undoHistory: UndoHistory = UndoHistory(),
            renderState: AppRenderState = .idle,
            paperSettings: PaperSettings = PaperSettings(),
            reduceMotionEnabled: Bool = false,
            presentedSheet: AppSheet? = nil
        ) {
            self.paper = paper
            self.undoHistory = undoHistory
            self.renderState = renderState
            self.paperSettings = paperSettings
            self.reduceMotionEnabled = reduceMotionEnabled
            self.presentedSheet = presentedSheet
        }
    }

    enum Action: Equatable {
        case animationCancelled
        case animationProgressed(Double)
        case customDimensionsChanged(width: Double, height: Double)
        case debugOverlayChanged(Bool)
        case flipButtonTapped
        case foldButtonTapped
        case infoButtonTapped
        case keyboardCommand(AppKeyboardCommand)
        case outlineChanged(Bool)
        case paperColorsChanged(PaperStyle)
        case paperFormatChanged(PaperFormat)
        case reduceMotionChanged(Bool)
        case resetButtonTapped
        case undoButtonTapped
        case settingsButtonTapped
        case sheetDismissed
    }

    @Dependency(\.continuousClock) private var clock
    @Dependency(\.faceIDGenerator) private var faceIDGenerator

    private enum CancelID { case animation }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .animationCancelled:
                state.renderState = .idle
                return .cancel(id: CancelID.animation)

            case let .customDimensionsChanged(width, height):
                guard state.renderState.isAnimating == false else { return .none }
                guard (try? PaperAspectRatio(width: width, height: height)) != nil else {
                    state.paperSettings.validationError = .invalidDimensions
                    return .none
                }
                guard let newPaper = try? Paper.rectangle(
                    id: state.paper.id,
                    faceID: faceIDGenerator(),
                    style: state.paper.style,
                    center: state.paper.center,
                    width: width,
                    height: height
                ) else {
                    state.paperSettings.validationError = .invalidDimensions
                    return .none
                }
                state.undoHistory = state.undoHistory.recording(state.paper)
                state.paper = newPaper
                state.paperSettings.format = .custom
                state.paperSettings.customWidth = width
                state.paperSettings.customHeight = height
                state.paperSettings.validationError = nil
                return .none

            case let .debugOverlayChanged(isEnabled):
                state.paperSettings.debugOverlayEnabled = isEnabled
                return .none

            case let .animationProgressed(progress):
                switch state.renderState {
                case let .folding(animation):
                    guard progress >= 1 else {
                        state.renderState = .folding(animation.withProgress(progress))
                        return .none
                    }
                    state.undoHistory = state.undoHistory.recording(state.paper)
                    state.paper = commitFold(
                        state.paper,
                        animation: animation.withProgress(1),
                        nextFaceID: faceIDGenerator.next
                    )
                    state.renderState = .idle
                    return .none

                case .flipping:
                    guard progress >= 1 else {
                        state.renderState = .flipping(progress: progress)
                        return .none
                    }
                    state.undoHistory = state.undoHistory.recording(state.paper)
                    state.paper = commitFlip(state.paper)
                    state.renderState = .idle
                    return .none

                case .idle:
                    return .none
                }

            case .flipButtonTapped:
                guard state.renderState.isAnimating == false else { return .none }
                guard state.reduceMotionEnabled == false else {
                    state.undoHistory = state.undoHistory.recording(state.paper)
                    state.paper = commitFlip(state.paper)
                    return .none
                }
                state.renderState = .flipping(progress: 0)
                return .run { [clock] send in
                    for step in 1...4 {
                        try await clock.sleep(for: .milliseconds(90))
                        await send(.animationProgressed(Double(step) / 4))
                    }
                }
                .cancellable(id: CancelID.animation)

            case .foldButtonTapped:
                guard state.renderState.isAnimating == false,
                      let request = centerFoldRequest(for: state.paper)
                else { return .none }
                let result = buildFold(
                    paper: state.paper,
                    request: request,
                    nextFaceID: faceIDGenerator.next
                )
                guard case let .success(animation) = result else { return .none }
                guard state.reduceMotionEnabled == false else {
                    state.undoHistory = state.undoHistory.recording(state.paper)
                    state.paper = commitFold(
                        state.paper,
                        animation: animation.withProgress(1),
                        nextFaceID: faceIDGenerator.next
                    )
                    return .none
                }
                state.renderState = .folding(animation)
                return .run { [clock] send in
                    for step in 1...4 {
                        try await clock.sleep(for: .milliseconds(115))
                        await send(.animationProgressed(Double(step) / 4))
                    }
                }
                .cancellable(id: CancelID.animation)

            case .infoButtonTapped:
                state.presentedSheet = .info
                return .none

            case let .keyboardCommand(command):
                switch command {
                case .fold:
                    return .send(.foldButtonTapped)
                case .flip:
                    return .send(.flipButtonTapped)
                case .reset:
                    return .send(.resetButtonTapped)
                }

            case let .paperColorsChanged(style):
                guard state.renderState.isAnimating == false,
                      let paper = try? Paper(
                        id: state.paper.id,
                        style: style,
                        center: state.paper.center,
                        rotation: state.paper.rotation,
                        scale: state.paper.scale,
                        baseSize: state.paper.baseSize,
                        faces: state.paper.faces
                      )
                else { return .none }
                state.paper = paper
                state.paperSettings.frontColor = style.frontColor
                state.paperSettings.backColor = style.backColor
                state.paperSettings.edgeColor = style.edgeColor
                return .none

            case let .outlineChanged(isEnabled):
                state.paperSettings.outlineEnabled = isEnabled
                return .none

            case let .paperFormatChanged(format):
                guard state.renderState.isAnimating == false else { return .none }
                let dimensions: (width: Double, height: Double)
                switch format {
                case .a4:
                    dimensions = (210, 297)
                case .square:
                    dimensions = (1, 1)
                case .custom:
                    dimensions = (state.paperSettings.customWidth, state.paperSettings.customHeight)
                }
                guard let newPaper = try? Paper.rectangle(
                    id: state.paper.id,
                    faceID: faceIDGenerator(),
                    style: state.paper.style,
                    center: state.paper.center,
                    width: dimensions.width,
                    height: dimensions.height
                ) else { return .none }
                state.undoHistory = state.undoHistory.recording(state.paper)
                state.paper = newPaper
                state.paperSettings.format = format
                state.paperSettings.validationError = nil
                return .none

            case .resetButtonTapped:
                guard state.renderState.isAnimating == false else { return .none }
                state.undoHistory = state.undoHistory.recording(state.paper)
                state.paper = reset(state.paper, nextFaceID: faceIDGenerator.next)
                return .none

            case let .reduceMotionChanged(isEnabled):
                state.reduceMotionEnabled = isEnabled
                return .none

            case .settingsButtonTapped:
                state.presentedSheet = .settings
                return .none

            case .sheetDismissed:
                state.presentedSheet = nil
                return .none

            case .undoButtonTapped:
                guard state.renderState.isAnimating == false,
                      let result = state.undoHistory.undoing(from: state.paper)
                else { return .none }
                state.paper = result.paper
                state.undoHistory = result.history
                return .none
            }
        }
    }
}

private extension FoldAnimation {
    func withProgress(_ progress: Double) -> Self {
        Self(
            paperID: paperID,
            duration: duration,
            progress: progress,
            line: line,
            moving: moving,
            stationaryFaces: stationaryFaces,
            movingFaces: movingFaces,
            foldedLayer: foldedLayer
        )
    }
}

private func centerFoldRequest(for paper: Paper) -> FoldRequest? {
    let points = paper.faces.flatMap { $0.polygon.vertices }
    guard
        let minimumX = points.map(\.x).min(),
        let maximumX = points.map(\.x).max(),
        let minimumY = points.map(\.y).min(),
        let maximumY = points.map(\.y).max()
    else { return nil }
    let center = Point2D(x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2)
    let direction = maximumX - minimumX >= maximumY - minimumY
        ? Point2D(x: 0, y: 1)
        : Point2D(x: 1, y: 0)
    guard let line = try? Line2D(point: center, direction: direction) else { return nil }
    return FoldRequest(line: line, moving: .positive)
}
