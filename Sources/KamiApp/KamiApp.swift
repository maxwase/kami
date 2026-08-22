import SwiftUI

@main
struct KamiApp: App {
    var body: some Scene {
        WindowGroup {
            PaperWorkspaceView()
        }
    }
}

private struct PaperWorkspaceView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settingsPresented = false

    var body: some View {
        ZStack {
            Color(red: 0.22, green: 0.14, blue: 0.09).ignoresSafeArea()
            RoundedRectangle(cornerRadius: 3)
                .fill(.white)
                .shadow(color: .black.opacity(0.28), radius: 12, y: 8)
                .aspectRatio(210 / 297, contentMode: .fit)
                .padding(48)
                .accessibilityLabel("A4 paper")
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button("Fold", systemImage: "rectangle.2.swap") {}
                Button("Flip", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right") {}
                Button("Reset", systemImage: "arrow.counterclockwise") {}
                Button("Undo", systemImage: "arrow.uturn.backward") {}
                Spacer()
                Button("Settings", systemImage: "gearshape") { settingsPresented = true }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderedProminent)
            .accessibilityElement(children: .contain)
            .padding()
            .background(.ultraThinMaterial)
        }
        .sheet(isPresented: $settingsPresented) {
            NavigationStack {
                Form {
                    Section("Paper") {
                        Picker("Size", selection: .constant("A4")) {
                            Text("A4").tag("A4")
                            Text("Square").tag("Square")
                            Text("Custom").tag("Custom")
                        }
                    }
                    Section("Accessibility") {
                        Text(reduceMotion ? "Reduce Motion is enabled." : "Animations follow system settings.")
                    }
                }
                .navigationTitle("Settings")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { settingsPresented = false } } }
            }
        }
    }
}
