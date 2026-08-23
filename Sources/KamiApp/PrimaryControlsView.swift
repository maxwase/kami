import SwiftUI

struct PrimaryControlsView: View {
    let isAnimating: Bool
    let canUndo: Bool
    let foldAction: () -> Void
    let flipAction: () -> Void
    let resetAction: () -> Void
    let undoAction: () -> Void

    var body: some View {
        if #available(iOS 26, *) {
            GlassEffectContainer(spacing: 10) {
                controls
            }
        } else {
            controls
                .padding(8)
                .background(.ultraThinMaterial, in: .capsule)
                .overlay { Capsule().stroke(.white.opacity(0.22), lineWidth: 0.5) }
        }
    }

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                actionButtons(compact: false)
            }
            HStack(spacing: 6) {
                actionButtons(compact: true)
            }
        }
    }

    @ViewBuilder
    private func actionButtons(compact: Bool) -> some View {
        ControlButton(
            title: "Fold",
            systemImage: "rectangle.portrait.and.arrow.forward",
            prominent: true,
            compact: compact,
            action: foldAction
        )
        .disabled(isAnimating)

        ControlButton(
            title: "Flip",
            systemImage: "arrow.left.and.right",
            prominent: false,
            compact: compact,
            action: flipAction
        )
        .disabled(isAnimating)

        ControlButton(
            title: "Reset",
            systemImage: "arrow.counterclockwise",
            prominent: false,
            compact: compact,
            action: resetAction
        )
        .disabled(isAnimating)

        ControlButton(
            title: "Undo",
            systemImage: "arrow.uturn.backward",
            prominent: false,
            compact: compact,
            action: undoAction
        )
        .disabled(isAnimating || canUndo == false)
    }
}

private struct ControlButton: View {
    let title: String
    let systemImage: String
    let prominent: Bool
    let compact: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if compact {
                Image(systemName: systemImage)
            } else {
                Label(title, systemImage: systemImage)
            }
        }
            .font(.callout.weight(.semibold))
            .frame(minWidth: 44, minHeight: 44)
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
