import Foundation

enum PaperDimensionText {
    static func parse(_ text: String, locale: Locale) -> Double? {
        try? formatStyle(locale: locale).parseStrategy.parse(text)
    }

    static func format(_ value: Double, locale: Locale) -> String {
        value.formatted(formatStyle(locale: locale))
    }

    private static func formatStyle(locale: Locale) -> FloatingPointFormatStyle<Double> {
        FloatingPointFormatStyle<Double>.number
            .grouping(.automatic)
            .precision(.fractionLength(0...4))
            .locale(locale)
    }
}
