import ComposableArchitecture
import KamiCore
import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var widthText: String
    @State private var heightText: String

    let store: StoreOf<AppFeature>

    init(store: StoreOf<AppFeature>) {
        self.store = store
        _widthText = State(initialValue: PaperDimensionText.format(store.paperSettings.customWidth, locale: .current))
        _heightText = State(initialValue: PaperDimensionText.format(store.paperSettings.customHeight, locale: .current))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Paper size", selection: formatSelection) {
                        Text("A4").tag(PaperFormat.a4)
                        Text("Square").tag(PaperFormat.square)
                        Text("Custom").tag(PaperFormat.custom)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel("Paper size")

                    if store.paperSettings.format == .custom {
                        LabeledContent("Width") {
                            TextField("Width", text: $widthText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityLabel("Custom width")
                        }
                        LabeledContent("Height") {
                            TextField("Height", text: $heightText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityLabel("Custom height")
                        }
                        Button("Apply custom size", action: applyCustomSize)
                        if store.paperSettings.validationError != nil {
                            Label("Enter positive width and height values.", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .accessibilityLabel("Invalid custom paper dimensions")
                        }
                    }
                } header: {
                    Text("Paper")
                } footer: {
                    Text("Choose a familiar proportion or enter your own dimensions.")
                }

                Section("Surface") {
                    PaperColorSelector(
                        title: "Front",
                        selection: store.paperSettings.frontColor,
                        selectionChanged: { applyColor(front: $0) }
                    )
                    PaperColorSelector(
                        title: "Back",
                        selection: store.paperSettings.backColor,
                        selectionChanged: { applyColor(back: $0) }
                    )
                    PaperColorSelector(
                        title: "Edge",
                        selection: store.paperSettings.edgeColor,
                        selectionChanged: { applyColor(edge: $0) }
                    )
                }

                Section("Display") {
                    Toggle("Paper outline", isOn: outlineSelection)
                    Toggle("Debug details", isOn: debugSelection)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var formatSelection: Binding<PaperFormat> {
        Binding(
            get: { store.paperSettings.format },
            set: { store.send(.paperFormatChanged($0)) }
        )
    }

    private var outlineSelection: Binding<Bool> {
        Binding(
            get: { store.paperSettings.outlineEnabled },
            set: { store.send(.outlineChanged($0)) }
        )
    }

    private var debugSelection: Binding<Bool> {
        Binding(
            get: { store.paperSettings.debugOverlayEnabled },
            set: { store.send(.debugOverlayChanged($0)) }
        )
    }

    private func applyCustomSize() {
        guard
            let width = PaperDimensionText.parse(widthText, locale: locale),
            let height = PaperDimensionText.parse(heightText, locale: locale)
        else {
            store.send(.customDimensionsRejected)
            return
        }
        store.send(.customDimensionsChanged(width: width, height: height))
    }

    private func applyColor(front: String? = nil, back: String? = nil, edge: String? = nil) {
        store.send(.paperColorsChanged(PaperStyle(
            frontColor: front ?? store.paperSettings.frontColor,
            backColor: back ?? store.paperSettings.backColor,
            edgeColor: edge ?? store.paperSettings.edgeColor
        )))
    }
}
