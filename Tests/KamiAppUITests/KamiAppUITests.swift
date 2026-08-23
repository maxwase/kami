import XCTest

@MainActor
final class KamiAppUITests: XCTestCase {
    func testInitialWorkspaceExposesPrimaryControls() {
        let app = XCUIApplication()
        app.launch()
        for title in ["Fold", "Flip", "Reset", "Undo"] {
            let control = app.buttons[title]
            XCTAssertTrue(control.waitForExistence(timeout: 2))
            XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThan(control.frame.width, 70, "\(title) must retain a visible text label.")
        }
        XCTAssertTrue(app.buttons["Settings"].exists)
        XCTAssertTrue(app.buttons["Information"].exists)
        let canvas = app.otherElements["Paper canvas"]
        XCTAssertTrue(canvas.exists)
        XCTAssertEqual(canvas.value as? String, "1 face, front side, Ready")
    }

    func testPrimaryActionsUpdateUndoAvailability() {
        let app = XCUIApplication()
        app.launch()

        let undo = app.buttons["Undo"]
        let canvas = app.otherElements["Paper canvas"]
        XCTAssertTrue(undo.exists)
        XCTAssertFalse(undo.isEnabled)

        app.buttons["Fold"].tap()
        wait(for: NSPredicate(format: "value CONTAINS '2 faces'"), on: canvas, timeout: 2)

        app.buttons["Undo"].tap()
        wait(for: NSPredicate(format: "value == '1 face, front side, Ready'"), on: canvas, timeout: 2)

        app.buttons["Flip"].tap()
        wait(for: NSPredicate(format: "value == '1 face, back side, Ready'"), on: canvas, timeout: 2)

        app.buttons["Reset"].tap()
        wait(for: NSPredicate(format: "value == '1 face, front side, Ready'"), on: canvas, timeout: 2)
        XCTAssertTrue(app.buttons["Undo"].isEnabled)
    }

    func testSettingsAndInformationArePresented() {
        let app = XCUIApplication()
        app.launch()

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.segmentedControls["Paper size"].exists)
        XCTAssertTrue(app.switches["Paper outline"].exists)
        app.buttons["Done"].tap()

        app.buttons["Information"].tap()
        XCTAssertTrue(app.navigationBars["About FoldFlow"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.staticTexts["A calm, tactile workspace for exploring paper one fold at a time."].exists)
    }

    func testAccessibilityTextSizeKeepsEveryPrimaryActionLabeled() {
        let app = XCUIApplication()
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
        ]
        app.launch()
        if app.staticTexts["Renderer unavailable"].waitForExistence(timeout: 1) {
            app.terminate()
            app.launch()
        }

        for title in ["Fold", "Flip", "Reset", "Undo"] {
            let control = app.buttons[title]
            XCTAssertTrue(control.waitForExistence(timeout: 2))
            XCTAssertGreaterThan(control.frame.width, 70)
        }
    }

    private func wait(for predicate: NSPredicate, on element: XCUIElement, timeout: TimeInterval) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
    }
}
