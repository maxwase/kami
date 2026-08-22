import KamiCore
import Testing

struct ProjectSmokeTests {
    @Test("KamiCore is available to the unit-test target")
    func kamiCoreIsAvailableToTheUnitTestTarget() {
        #expect(PaperAspectRatio.a4.value > 0)
    }
}
