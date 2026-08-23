import SwiftUI

struct InfoView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: "square.3.layers.3d.top.filled")
                        .font(.system(.largeTitle, design: .rounded, weight: .medium))
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)

                    VStack(spacing: 8) {
                        Text("FoldFlow")
                            .font(.title.bold())
                        Text("A calm, tactile workspace for exploring paper one fold at a time.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        InfoRow(icon: "rectangle.portrait.and.arrow.forward", title: "Fold", detail: "Creases the paper through its center.")
                        InfoRow(icon: "arrow.left.and.right", title: "Flip", detail: "Turns the paper over to reveal its other side.")
                        InfoRow(icon: "arrow.uturn.backward", title: "Undo", detail: "Steps back through your folding history.")
                    }
                    .padding(20)
                    .background(.thinMaterial, in: .rect(cornerRadius: 20))
                }
                .padding(24)
            }
            .navigationTitle("About FoldFlow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct InfoRow: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .frame(width: 28, height: 28)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
