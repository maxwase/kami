import SwiftUI

struct PaperColorSelector: View {
    let title: String
    let selection: String
    let selectionChanged: (String) -> Void

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 10) {
                ForEach(PaperInk.allCases) { ink in
                    Button {
                        selectionChanged(ink.hex)
                    } label: {
                        Circle()
                            .fill(ink.color)
                            .frame(width: 32, height: 32)
                            .overlay {
                                Circle()
                                    .stroke(selection == ink.hex ? Color.accentColor : .secondary.opacity(0.3), lineWidth: selection == ink.hex ? 3 : 1)
                            }
                    }
                    .buttonStyle(.plain)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
                    .accessibilityLabel("\(title), \(ink.name)")
                    .accessibilityAddTraits(selection == ink.hex ? .isSelected : [])
                }
            }
        }
    }
}
