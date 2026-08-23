import ComposableArchitecture
import KamiCore
import SwiftUI
import UIKit

struct PaperWorkspaceView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    let store: StoreOf<AppFeature>
    let frameRenderer: RenderFrameRenderer

    var body: some View {
        ZStack {
            PaperCanvasView(
                frameRenderer: frameRenderer,
                renderFrame: RenderFrame(
                    paper: store.paper,
                    animation: store.renderState.rendererAnimation,
                    outlineEnabled: store.paperSettings.outlineEnabled
                ),
                accessibilityValue: store.canvasAccessibilityValue
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [.black.opacity(0.20), .clear, .black.opacity(0.16)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 12) {
                WorkspaceHeaderView(
                    isAnimating: store.renderState.isAnimating,
                    settingsAction: { store.send(.settingsButtonTapped) },
                    infoAction: { store.send(.infoButtonTapped) }
                )
                Spacer()
                if store.paperSettings.debugOverlayEnabled {
                    DebugOverlayView(
                        faceCount: store.paper.faces.count,
                        status: statusText
                    )
                }
            }
            .padding(.horizontal)
            .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom) {
            PrimaryControlsView(
                isAnimating: store.renderState.isAnimating,
                canUndo: store.undoHistory.snapshots.isEmpty == false,
                foldAction: { store.send(.foldButtonTapped) },
                flipAction: { store.send(.flipButtonTapped) },
                resetAction: { store.send(.resetButtonTapped) },
                undoAction: { store.send(.undoButtonTapped) }
            )
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .sheet(item: presentedSheet) { sheet in
            switch sheet {
            case .settings:
                SettingsView(store: store)
            case .info:
                InfoView()
            }
        }
        .task(id: reduceMotion) {
            store.send(.reduceMotionChanged(reduceMotion))
        }
        .onChange(of: store.accessibilityAnnouncement) { _, announcement in
            guard let announcement else { return }
            UIAccessibility.post(notification: .announcement, argument: announcement)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
            store.send(.animationCancelled)
        }
        .onDisappear {
            store.send(.animationCancelled)
        }
    }

    private var statusText: String {
        switch store.renderState {
        case .idle:
            "Ready"
        case .folding:
            "Folding"
        case .flipping:
            "Flipping"
        }
    }

    private var presentedSheet: Binding<AppSheet?> {
        Binding(
            get: { store.presentedSheet },
            set: { newValue in
                if newValue == nil { store.send(.sheetDismissed) }
            }
        )
    }
}
