import ComposableArchitecture
import Foundation
import KamiCore

@Reducer
struct AppFeature {
    @ObservableState
    struct State: Equatable {
        var paper: Paper
        var undoHistory: AppUndoHistory
        var renderState: AppRenderState
        var paperSettings: PaperSettings
        var foldRejection: FoldRejection?
        var accessibilityAnnouncement: String?
        var reduceMotionEnabled: Bool
        var presentedSheet: AppSheet?

        init(
            paper: Paper,
            undoHistory: AppUndoHistory = AppUndoHistory(),
            renderState: AppRenderState = .idle,
            paperSettings: PaperSettings = PaperSettings(),
            foldRejection: FoldRejection? = nil,
            accessibilityAnnouncement: String? = nil,
            reduceMotionEnabled: Bool = false,
            presentedSheet: AppSheet? = nil
        ) {
            self.paper = paper
            self.undoHistory = undoHistory
            self.renderState = renderState
            self.paperSettings = paperSettings
            self.foldRejection = foldRejection
            self.accessibilityAnnouncement = accessibilityAnnouncement
            self.reduceMotionEnabled = reduceMotionEnabled
            self.presentedSheet = presentedSheet
        }
    }

    enum Action: Equatable {
        case animationCancelled
        case animationCompleted
        case animationProgressed(Double)
        case customDimensionsChanged(width: Double, height: Double)
        case customDimensionsRejected
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
    @Dependency(\.animationTimeline) private var animationTimeline
    @Dependency(\.faceIDGenerator) private var faceIDGenerator

    private enum CancelID { case animation }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .animationCancelled:
                state.renderState = .idle
                return .cancel(id: CancelID.animation)

            case .animationCompleted:
                finishAnimation(state: &state, nextFaceID: faceIDGenerator.next)
                return .none

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
                state.undoHistory = state.undoHistory.recording(
                    paper: state.paper,
                    paperSettings: state.paperSettings
                )
                state.paper = newPaper
                state.paperSettings.format = .custom
                state.paperSettings.customWidth = width
                state.paperSettings.customHeight = height
                state.paperSettings.validationError = nil
                return .none

            case .customDimensionsRejected:
                state.paperSettings.validationError = .invalidDimensions
                return .none

            case let .debugOverlayChanged(isEnabled):
                state.paperSettings.debugOverlayEnabled = isEnabled
                return .none

            case let .animationProgressed(progress):
                switch state.renderState {
                case let .folding(animation):
                    state.renderState = .folding(animation.withProgress(progress))
                    return .none

                case let .flipping(animation):
                    state.renderState = .flipping(animation.withProgress(progress))
                    return .none

                case .idle:
                    return .none
                }

            case .flipButtonTapped:
                guard state.renderState.isAnimating == false else { return .none }
                guard let animation = flipAnimation(for: state.paper) else { return .none }
                guard state.reduceMotionEnabled == false else {
                    state.undoHistory = state.undoHistory.recording(
                        paper: state.paper,
                        paperSettings: state.paperSettings
                    )
                    state.paper = commitFlip(state.paper)
                    state.accessibilityAnnouncement = "Flip complete"
                    return .none
                }
                state.renderState = .flipping(animation)
                return animationEffect(duration: animation.duration)

            case .foldButtonTapped:
                guard state.renderState.isAnimating == false else { return .none }
                guard let request = centerFoldRequest(for: state.paper) else {
                    state.foldRejection = .noIntersection
                    return .none
                }
                let result = buildFold(
                    paper: state.paper,
                    request: request,
                    nextFaceID: faceIDGenerator.next
                )
                guard case let .success(animation) = result else {
                    if case let .failure(rejection) = result {
                        state.foldRejection = rejection
                    }
                    return .none
                }
                state.foldRejection = nil
                guard state.reduceMotionEnabled == false else {
                    state.undoHistory = state.undoHistory.recording(
                        paper: state.paper,
                        paperSettings: state.paperSettings
                    )
                    state.paper = commitFold(
                        state.paper,
                        animation: animation.withProgress(1),
                        nextFaceID: faceIDGenerator.next
                    )
                    state.accessibilityAnnouncement = "Fold complete"
                    return .none
                }
                state.renderState = .folding(animation)
                return animationEffect(duration: animation.duration)

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
                state.undoHistory = state.undoHistory.recording(
                    paper: state.paper,
                    paperSettings: state.paperSettings
                )
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
                guard (try? PaperAspectRatio(width: dimensions.width, height: dimensions.height)) != nil else {
                    state.paperSettings.validationError = .invalidDimensions
                    return .none
                }
                guard let newPaper = try? Paper.rectangle(
                    id: state.paper.id,
                    faceID: faceIDGenerator(),
                    style: state.paper.style,
                    center: state.paper.center,
                    width: dimensions.width,
                    height: dimensions.height
                ) else {
                    state.paperSettings.validationError = .invalidDimensions
                    return .none
                }
                state.undoHistory = state.undoHistory.recording(
                    paper: state.paper,
                    paperSettings: state.paperSettings
                )
                state.paper = newPaper
                state.paperSettings.format = format
                state.paperSettings.validationError = nil
                return .none

            case .resetButtonTapped:
                guard state.renderState.isAnimating == false else { return .none }
                state.undoHistory = state.undoHistory.recording(
                    paper: state.paper,
                    paperSettings: state.paperSettings
                )
                state.paper = reset(state.paper, nextFaceID: faceIDGenerator.next)
                state.paperSettings.validationError = nil
                state.foldRejection = nil
                state.accessibilityAnnouncement = "Paper reset"
                return .none

            case let .reduceMotionChanged(isEnabled):
                state.reduceMotionEnabled = isEnabled
                guard isEnabled, state.renderState.isAnimating else { return .none }
                finishAnimation(state: &state, nextFaceID: faceIDGenerator.next)
                return .cancel(id: CancelID.animation)

            case .settingsButtonTapped:
                state.presentedSheet = .settings
                return .none

            case .sheetDismissed:
                state.presentedSheet = nil
                return .none

            case .undoButtonTapped:
                guard state.renderState.isAnimating == false,
                      let result = state.undoHistory.undoing()
                else { return .none }
                state.paper = result.snapshot.paper
                state.paperSettings = result.snapshot.paperSettings.restoring(into: state.paperSettings)
                state.undoHistory = result.history
                return .none
            }
        }
    }

    private func animationEffect(duration: Duration) -> Effect<Action> {
        let ticks = animationTimeline.ticks(duration)
        let endpointHold = animationTimeline.endpointHold
        return .run { [clock] send in
            for tick in ticks {
                try Task.checkCancellation()
                try await clock.sleep(for: tick.delay)
                await send(.animationProgressed(tick.progress))
            }
            try Task.checkCancellation()
            try await clock.sleep(for: endpointHold)
            await send(.animationCompleted)
        }
        .cancellable(id: CancelID.animation, cancelInFlight: true)
    }
}

extension AppFeature.State {
    var keyboardCommandsEnabled: Bool {
        renderState.isAnimating == false
    }

    var canvasAccessibilityValue: String {
        let faceDescription = paper.faces.count == 1 ? "1 face" : "\(paper.faces.count) faces"
        let visibleSide = paper.faces.max(by: { $0.layer < $1.layer })?.visibleSide.rawValue ?? "no visible"
        let status: String
        switch renderState {
        case .idle:
            status = "Ready"
        case let .folding(animation):
            status = "Folding \(Int((animation.progress * 100).rounded()))%"
        case let .flipping(animation):
            status = "Flipping \(Int((animation.progress * 100).rounded()))%"
        }
        return "\(faceDescription), \(visibleSide) side, \(status)"
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

private func flipAnimation(for paper: Paper) -> FoldAnimation? {
    let points = paper.faces.flatMap { $0.polygon.vertices }
    guard
        let minimumX = points.map(\.x).min(),
        let maximumX = points.map(\.x).max(),
        let minimumY = points.map(\.y).min(),
        let maximumY = points.map(\.y).max(),
        let line = try? Line2D(
            point: Point2D(x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2),
            direction: Point2D(x: 0, y: 1)
        )
    else { return nil }
    let maximumLayer = paper.faces.map(\.layer).max() ?? 0
    let (foldedLayer, overflow) = maximumLayer.addingReportingOverflow(1)
    guard overflow == false else { return nil }
    return FoldAnimation(
        paperID: paper.id,
        duration: .milliseconds(360),
        line: line,
        moving: .positive,
        stationaryFaces: [],
        movingFaces: paper.faces,
        foldedLayer: foldedLayer
    )
}

private func finishAnimation(
    state: inout AppFeature.State,
    nextFaceID: () -> FaceID
) {
    let renderState = state.renderState
    guard renderState.isAnimating else { return }
    state.undoHistory = state.undoHistory.recording(
        paper: state.paper,
        paperSettings: state.paperSettings
    )
    switch renderState {
    case .idle:
        return
    case let .folding(animation):
        state.paper = commitFold(
            state.paper,
            animation: animation.withProgress(1),
            nextFaceID: nextFaceID
        )
        state.accessibilityAnnouncement = "Fold complete"
    case .flipping:
        state.paper = commitFlip(state.paper)
        state.accessibilityAnnouncement = "Flip complete"
    }
    state.renderState = .idle
}
