import ComposableArchitecture
import KamiCore
import SwiftUI

@main
struct KamiApp: App {
    @MainActor
    private static let store = Store(initialState: AppFeature.State(paper: initialPaper())) {
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
                .keyboardShortcut("f", modifiers: .command)

                Button("Flip") {
                    Self.store.send(.keyboardCommand(.flip))
                }
                .keyboardShortcut("l", modifiers: .command)

                Button("Reset") {
                    Self.store.send(.keyboardCommand(.reset))
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
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
