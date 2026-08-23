import SwiftUI

struct WorkspaceHeaderView: View {
    let isAnimating: Bool
    let settingsAction: () -> Void
    let infoAction: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text("FoldFlow")
                    .font(.headline)
                    .fontWeight(.semibold)
                Text(isAnimating ? "Creasing paper…" : "A quiet space to fold")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: 8)

            HeaderButton(title: "Information", systemImage: "info.circle", action: infoAction)
            HeaderButton(title: "Settings", systemImage: "slider.horizontal.3", action: settingsAction)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .foldFlowGlassPanel()
    }
}

private struct HeaderButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(title, systemImage: systemImage, action: action)
            .labelStyle(.iconOnly)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
            .accessibilityLabel(title)
            .accessibilityIdentifier(title)
            .modifier(HeaderButtonStyle())
    }
}

private struct HeaderButtonStyle: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.buttonStyle(.glass)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}
