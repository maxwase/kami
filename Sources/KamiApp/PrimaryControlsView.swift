import SwiftUI

struct PrimaryControlsView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let isAnimating: Bool
    let canUndo: Bool
    let foldAction: () -> Void
    let flipAction: () -> Void
    let resetAction: () -> Void
    let undoAction: () -> Void

    var body: some View {
        if #available(iOS 26, *) {
            GlassEffectContainer(spacing: 10) {
                adaptiveControls
            }
        } else {
            adaptiveControls
                .padding(8)
                .background(.ultraThinMaterial, in: .rect(cornerRadius: 22))
                .overlay {
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(.primary.opacity(0.14), lineWidth: 0.5)
                }
        }
    }

    @ViewBuilder
    private var adaptiveControls: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: 8) {
                control(.fold)
                control(.flip)
                control(.reset)
                control(.undo)
            }
        } else {
            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: 8
            ) {
                control(.fold)
                control(.flip)
                control(.reset)
                control(.undo)
            }
        }
    }

    private func control(_ kind: PrimaryControl) -> some View {
        ControlButton(
            title: kind.title,
            systemImage: kind.systemImage,
            prominent: kind == .fold,
            action: action(for: kind)
        )
        .disabled(isAnimating || (kind == .undo && canUndo == false))
    }

    private func action(for kind: PrimaryControl) -> () -> Void {
        switch kind {
        case .fold: foldAction
        case .flip: flipAction
        case .reset: resetAction
        case .undo: undoAction
        }
    }
}

private enum PrimaryControl: CaseIterable {
    case fold
    case flip
    case reset
    case undo

    var title: String {
        switch self {
        case .fold: "Fold"
        case .flip: "Flip"
        case .reset: "Reset"
        case .undo: "Undo"
        }
    }

    var systemImage: String {
        switch self {
        case .fold: "rectangle.portrait.on.rectangle.portrait"
        case .flip: "arrow.left.and.right"
        case .reset: "arrow.counterclockwise"
        case .undo: "arrow.uturn.backward"
        }
    }

}

private struct ControlButton: View {
    let title: String
    let systemImage: String
    let prominent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .lineLimit(1)
                .frame(minHeight: 44)
        }
        .font(.callout.weight(.semibold))
        .frame(minWidth: 72, minHeight: 44)
        .contentShape(.capsule)
        .accessibilityLabel(title)
        .accessibilityIdentifier(title)
        .modifier(GlassControlButtonStyle(prominent: prominent))
    }
}

private struct GlassControlButtonStyle: ViewModifier {
    let prominent: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            if prominent {
                content.buttonStyle(.glassProminent)
            } else {
                content.buttonStyle(.glass)
            }
        } else if prominent {
            content.buttonStyle(.borderedProminent)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}
