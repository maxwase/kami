# Kami Native iOS — Task 2 Geometry Handoff

## Starting state

- Worktree: `/Users/max/dev/my/kami-swift`, branch `kami-swift`.
- Task 1 is committed as `cc55377` (`build: stabilize native simulator project`).
- The generated Xcode project contains the shared `KamiApp` scheme, core and UI
  test targets, and the committed SwiftPM resolution file. Recreate it with
  `xcodegen generate` (XcodeGen 2.46.0).
- Fresh verification completed on iPhone 17 Pro / iOS 26.5:

  ```sh
  xcodebuild test -quiet -skipMacroValidation \
    -project Kami.xcodeproj -scheme KamiApp \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
    CODE_SIGNING_ALLOWED=NO
  ```

  Its result bundle reports 5 passed, 0 failed, 0 skipped tests.
- `.swiftpm/` is intentionally ignored because it contains user-specific Xcode
  state. `Kami.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
  is the committed reproducible lockfile.

## Task 2 objective

Complete deterministic KamiCore geometry according to Task 2 in
`2026-08-22-kami-native-ios-handoff.md`, and commit it as
`feat: complete typed paper geometry`.

The current implementation is entirely in
`Sources/KamiCore/Geometry/Geometry.swift`. It already has validated
`Point2D`, `Line2D`, `Polygon`, half-plane clipping, and reflection. It does
not expose winding or point-in-polygon hit testing, and it uses an internal
signed-area helper. The current targeted tests are
`Tests/KamiCoreTests/Geometry/ClipperTests.swift`.

## Execute in this order

1. Read the main implementation plan and invoke its required execution, TDD,
   Swift Testing, and Swift-concurrency skills before changing source.
2. Add the smallest focused Swift Testing cases first, including:
   - the `horizontal-center-fold` fixture from `web-parity.json`;
   - a line wholly outside a polygon (one empty side, one unchanged side);
   - degenerate line and polygon validation errors;
   - reflection across vertical and horizontal lines;
   - clockwise and counter-clockwise winding; and
   - point-in-polygon inside, outside, and boundary behavior.
3. Run the focused core test target and confirm each new test fails for the
   missing API or behavior—not a test-target configuration failure.
4. Split the monolithic geometry implementation into focused source files
   under `Sources/KamiCore/Geometry/` while preserving public type names and
   value semantics. Keep tolerance/canonicalization deterministic. Make
   clipped degenerate output `Polygon.empty`; reserve `GeometryError` for
   invalid constructors.
5. Implement only enough public API to make the red tests green. Use explicit
   boundary inclusion for point-in-polygon and document that choice in the
   test name.
6. Run the focused core tests, then the full simulator command above. Inspect
   the resulting test bundle and Git diff. Do not delete the legacy stacks;
   that is Task 10.
7. Commit only Task 2 files with the planned commit message.

## Known non-blocking warning

`actool` warns that `Textures.dataset` has an unassigned `wood.jpg` child.
Do not remove either texture during Task 2. Resolve the data-set structure as
part of Task 5, where the renderer begins consuming paper and wood textures.
