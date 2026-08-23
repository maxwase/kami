import SwiftUI

enum PaperInk: String, CaseIterable, Identifiable {
    case cloud
    case blush
    case sage
    case sky
    case graphite

    var id: Self { self }

    var name: String {
        switch self {
        case .cloud: "Cloud"
        case .blush: "Blush"
        case .sage: "Sage"
        case .sky: "Sky"
        case .graphite: "Graphite"
        }
    }

    var hex: String {
        switch self {
        case .cloud: "#FFFFFF"
        case .blush: "#F4C7C3"
        case .sage: "#BFD8C1"
        case .sky: "#BFD7EA"
        case .graphite: "#34353A"
        }
    }

    var color: Color {
        switch self {
        case .cloud: .white
        case .blush: Color(red: 0.96, green: 0.78, blue: 0.76)
        case .sage: Color(red: 0.75, green: 0.85, blue: 0.76)
        case .sky: Color(red: 0.75, green: 0.84, blue: 0.92)
        case .graphite: Color(red: 0.20, green: 0.21, blue: 0.23)
        }
    }
}
