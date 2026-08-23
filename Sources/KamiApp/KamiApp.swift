import ComposableArchitecture
import KamiCore
import SwiftUI
import UIKit

@main
struct KamiApp: App {
    @MainActor
    private static let store = Store(initialState: AppFeature.State(
        paper: initialPaper(),
        reduceMotionEnabled: UIAccessibility.isReduceMotionEnabled
    )) {
        AppFeature()
    }

    @MainActor
    private static let frameRenderer = try? RenderFrameRenderer()

    var body: some Scene {
        WindowGroup {
            if let frameRenderer = Self.frameRenderer {
                PaperWorkspaceView(store: Self.store, frameRenderer: frameRenderer)
            } else {
                ContentUnavailableView(
                    "Renderer unavailable",
                    systemImage: "doc.badge.gearshape",
                    description: Text("FoldFlow needs Metal to display your paper.")
                )
            }
        }
        .commands {
            CommandMenu("Paper") {
                Button("Fold") {
                    Self.store.send(.keyboardCommand(.fold))
                }
                .keyboardShortcut(
                    AppKeyboardCommand.fold.shortcut.keyEquivalent,
                    modifiers: AppKeyboardCommand.fold.shortcut.eventModifiers
                )
                .disabled(Self.store.keyboardCommandsEnabled == false)

                Button("Flip") {
                    Self.store.send(.keyboardCommand(.flip))
                }
                .keyboardShortcut(
                    AppKeyboardCommand.flip.shortcut.keyEquivalent,
                    modifiers: AppKeyboardCommand.flip.shortcut.eventModifiers
                )
                .disabled(Self.store.keyboardCommandsEnabled == false)

                Button("Reset") {
                    Self.store.send(.keyboardCommand(.reset))
                }
                .keyboardShortcut(
                    AppKeyboardCommand.reset.shortcut.keyEquivalent,
                    modifiers: AppKeyboardCommand.reset.shortcut.eventModifiers
                )
                .disabled(Self.store.keyboardCommandsEnabled == false)
            }
        }
    }

    private static func initialPaper() -> Paper {
        guard let paper = try? Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 1),
            style: .white,
            center: Point2D(x: 0, y: 0),
            width: 210,
            height: 297
        ) else {
            preconditionFailure("FoldFlow's validated default paper could not be created.")
        }
        return paper
    }
}
