# Kami Native iPhone Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Kami's web/Tauri/Android implementation with a fully native,
simulator-buildable iPhone app while preserving the behavior at `76ff4e7`.

**Architecture:** `KamiCore` is a Swift 6 value-semantic library containing all
paper state and render snapshots. `KamiApp` owns TCA reducers, injected clients,
SwiftUI controls, and a Core Graphics renderer that consumes `RenderFrame`; a
MetalKit renderer may replace only that backend if the stated visual or frame
budget gates fail.

**Tech Stack:** Swift 6.3, iOS 18+, SwiftUI, TCA 1.26.1, PostHog 3.69.5,
SnapshotTesting 1.19.2, Swift Testing, XCTest/XCUITest, XcodeGen 2.46.0,
SwiftLint 0.65.0.

**Spec:** `docs/native-rewrite-contract.md`; fixture source:
`docs/web-parity-fixtures.md` and `Tests/KamiCoreTests/Fixtures/web-parity.json`.

## Current handoff state

Committed work ends at `4caeaf1` on branch `kami-swift`:

| Commit | Delivered |
| --- | --- |
| `e190698` | Native contract, parity matrix, renderer gates, signing-neutral policy |
| `dde4a2f` | Deterministic geometry and render-scene fixtures from `76ff4e7` |
| `0edfc14` | XcodeGen project, dependency pins, app/test targets, assets, privacy manifest, CI |
| `2392133` | `Point2D`, `Line2D`, `Polygon`, validated clipping |
| `4caeaf1` | Typed paper model and an initial immutable fold operation |

The native app currently displays only a placeholder white sheet and inactive
buttons. It is not parity-complete. The old web/Tauri/Android files are still
present intentionally: delete them only after the native app builds and the
core native control path works.

The working tree currently contains generated/project-resolution changes:

```
M  Kami.xcodeproj/project.pbxproj
M  Resources/Assets.xcassets/AccentColor.colorset/Contents.json
?? .swiftpm/
?? Kami.xcodeproj/project.xcworkspace/xcshareddata/
```

The AccentColor JSON edit repairs an `actool` parse error. Inspect and retain
only the reproducible `Package.resolved`, Xcode project package references, and
the repaired catalog; do not commit user-specific IDE state.

For noninteractive builds, TCA's trusted package macros require the documented
`-skipMacroValidation` option. Use:

```sh
xcodegen generate
xcodebuild test -skipMacroValidation \
  -project Kami.xcodeproj -scheme KamiApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  CODE_SIGNING_ALLOWED=NO
```

## Global constraints — non-negotiable

- Work only in `/Users/max/dev/my/kami-swift` on branch `kami-swift`; make
  atomic commits and never push, merge, or rebase.
- The product is native iOS only, iOS 18+ minimum, bundle ID
  `eu.maxwase.kami`; FoldFlow remains the brand.
- Generate and commit `Kami.xcodeproj` with XcodeGen **2.46.0**. Pin TCA
  **1.26.1**, PostHog **3.69.5**, SnapshotTesting **1.19.2**, and SwiftLint
  **0.65.0** exactly. Commit the resolved package lockfile.
- Keep `DEVELOPMENT_TEAM` empty. Never commit signing identities, certificates,
  team IDs, D-U-N-S numbers, Apple credentials, PostHog tokens, or secrets.
  `Signing.xcconfig` stays ignored; simulator and CI builds are unsigned.
- Use only public Apple APIs. `FoldStateClient` ships as unavailable and
  documents the conceptual fold state, hinge angle, mechanical angle, and
  display count; it must not use private APIs or selectors.
- A software Fold action works on every supported iPhone, regardless of motion
  permission, fold hardware, or any future public fold API.
- Preserve every valid polygon; do not cap faces, simplify stacks, or hide
  offscreen/layered geometry as an optimization.
- PostHog initializes only after explicit opt-in. Disable autocapture and
  session replay. Never transmit raw or derived motion samples.
- No cloud storage, ads, purchases, private APIs, App Store submission, Apple
  enrollment, account creation, release signing, or seller-identity decision.

## Required code practices

- Use Swift 6.3 strict concurrency. Default to immutable `struct`, `enum`,
  `Sendable` value types and actor isolation; never silence diagnostics with
  `@unchecked Sendable`.
- Use typed IDs (`PaperID`, `FaceID`) and typed errors/rejections. Constructors
  validate finite, positive dimensions and nondegenerate geometry. Invalid
  requests return/throw a typed rejection and leave the existing state intact.
- No production `!`, `try!`, `as!`, or force-unwrapped optionals. Use
  `guard`, `throws`, and safe collection access.
- Model durations as `Duration`; inject `ContinuousClock` through TCA instead
  of measuring wall-clock time. Effects, IDs, texture loads, motion streams,
  and analytics are injected dependencies.
- Keep render input immutable: the renderer consumes `RenderFrame`, never
  mutates `Paper`. Make coordinate-space boundaries explicit in names
  (`local`, `screen`, `view`).
- Write the smallest Swift Testing or XCTest test first and run it red before
  production code. Then implement the minimum green change, run the focused
  test plus full suite, and commit. Use `#expect`, `#require`, and test structs;
  reserve XCTest for UI tests.
- Test reducers with TCA `TestStore`; use deterministic test clocks and stream
  clients. Do not test a SwiftUI view's private state directly.
- Keep views small and composed by feature. Use native accessibility labels,
  Dynamic Type-resilient layout, `NavigationStack`/sheets, safe-area insets,
  and `accessibilityReduceMotion`.
- Before any completion claim, run fresh test/build evidence, inspect Git
  status, and state unverified acceptance gates plainly.

## File map

| Path | Responsibility |
| --- | --- |
| `Sources/KamiCore/Geometry/Geometry.swift` | Vectors, lines, polygon validation, half-plane clipping/reflection |
| `Sources/KamiCore/Paper/Paper.swift` | IDs, paper/face/style, fold request, typed rejections, render values |
| `Sources/KamiCore/Paper/Fold.swift` | Split/reflect/dedupe/layer inversion/fold animation |
| `Sources/KamiCore/Paper/Flip.swift` | Whole-stack flip and layer inversion |
| `Sources/KamiCore/Paper/Undo.swift` | Immutable snapshots and bounded undo state |
| `Sources/KamiCore/Paper/Sizing.swift` | A4/square/custom validation and safe-area fit calculations |
| `Sources/KamiApp/AppFeature.swift` | Root TCA state, actions, reducer, lifecycle and effects |
| `Sources/KamiApp/Clients/` | Motion, fold state, analytics, clocks, IDs, texture loading |
| `Sources/KamiApp/Renderer/` | `RenderFrame` → Core Graphics proof renderer and display driver |
| `Sources/KamiApp/Views/` | Canvas host, controls, Settings/Info/Privacy sheets |
| `Tests/KamiCoreTests/` | Geometry, folds, flips, undo, validation, sizing, fixtures |
| `Tests/KamiAppTests/` | Reducer and client integration tests using `TestStore` |
| `Tests/KamiSnapshotTests/` | Render-scene snapshots and face-count performance assertions |
| `Tests/KamiAppUITests/` | User-visible acceptance flows |

## Execution tasks

### Task 1: Stabilize the project and test baseline

**Files:** modify `project.yml`, CI workflow, generated project, asset catalog;
commit the resolved package lockfile; add `Tests/KamiCoreTests/ProjectSmokeTests.swift`.

**Produces:** a clean, reproducible native project whose app, unit tests, and
UI test bundles are discoverable on the iPhone 17 Pro simulator.

- [x] Write a failing `@Test` that imports `KamiCore` and asserts
  `PaperAspectRatio.a4.value > 0`.
- [x] Run the focused target on the iPhone 17 Pro simulator with
  `-skipMacroValidation`; confirm the failure comes from the project/test
  configuration, not a missing simulator.
- [x] Repair the target membership, asset metadata, generated package lockfile,
  and CI command. CI must include `-skipMacroValidation` and
  `CODE_SIGNING_ALLOWED=NO`.
- [x] Run the full simulator test command above; confirm a nonzero test count
  and a successful result bundle.
- [x] Commit `build: stabilize native simulator project`.

### Task 2: Finish exact `KamiCore` geometry

**Files:** split `Geometry.swift` into focused vector/line/polygon files;
expand `ClipperTests.swift` and add hit-test/validation tests.

**Consumes:** the JSON parity fixtures. **Produces:** robust, deterministic
geometry operations with no mutable global state.

- [ ] Add failing parameterized tests for horizontal clipping, no intersection,
  degenerate input, reflected points, winding, and point-in-polygon hit tests.
- [ ] Make each test fail against the current API before implementation.
- [ ] Implement the smallest typed API necessary; ensure clipped degenerate
  pieces become empty and invalid construction throws `GeometryError`.
- [ ] Run the core test target and the full simulator suite.
- [ ] Commit `feat: complete typed paper geometry`.

### Task 3: Complete fold, flip, reset, and undo

**Files:** create `Fold.swift`, `Flip.swift`, `Undo.swift`; simplify
`Paper.swift`; add tests mirroring `src/paper/fold.ts`, `flip.ts`, and
`model.ts` at `76ff4e7`.

**Interfaces:**

```swift
func buildFold(paper: Paper, request: FoldRequest, nextFaceID: () -> FaceID)
  -> Result<FoldAnimation, FoldRejection>
func commitFold(_ paper: Paper, animation: FoldAnimation, nextFaceID: () -> FaceID) -> Paper
func commitFlip(_ paper: Paper) -> Paper
func restoring(_ paper: Paper, snapshot: PaperSnapshot) -> Paper
```

- [ ] Add red tests for side switching, layer inversion, duplicate polygon
  elimination, empty stationary/moving rejection, reset, immutable undo, and
  flip around a rotated paper's screen-vertical axis.
- [ ] Implement split/reflect/animation commit with deterministic ID injection;
  retain all valid faces and canonicalize only for exact duplicate comparison.
- [ ] Run unit tests and the full simulator suite.
- [ ] Commit `feat: complete fold flip and undo simulation`.

### Task 4: Add sizing and immutable render snapshots

**Files:** create `Sizing.swift`, `RenderFrame.swift`, and matching tests.

- [ ] Add red tests for A4, square, valid custom ratios, malformed custom
  dimensions, portrait/landscape fit, and safe-area-aware centering.
- [ ] Implement finite dimension validation and a pure snapshot builder that
  exposes faces, fold progress, transform, style, hinge, and outline state.
- [ ] Run focused and full tests.
- [ ] Commit `feat: add paper sizing and render snapshots`.

### Task 5: Build the Core Graphics renderer proof

**Files:** create `Renderer/RenderFrameRenderer.swift`, texture cache and
display-link host; add snapshot/performance tests and reference images.

- [ ] Add failing snapshots for fixture scenes `flat-a4`, `folding-a4`,
  `layered-stack`, and `flipping-a4`, in both portrait and landscape.
- [ ] Implement perspective projection, real paper/wood textures, diffuse
  lighting, soft shadows, creases, and optional outlines from `RenderFrame`.
- [ ] Add a performance test that builds 1, 64, and 256 faces and asserts the
  renderer processed every face; measure the 1–64 p95 budget under 16.7 ms.
- [ ] Compare perceptual precision against the reference images. If either the
  97% precision or 16.7 ms p95 gate fails, preserve `RenderFrame` and replace
  only the backend with MetalKit before committing.
- [ ] Commit `feat: add native paper renderer`.

### Task 6: Introduce TCA app state and controls

**Files:** create `AppFeature.swift`, `PaperCanvasView.swift`,
`PrimaryControlsView.swift`, settings/info views, and `KamiAppTests`.

- [ ] Add red `TestStore` cases for Fold, Flip, Reset, Undo, animation timing,
  keyboard actions, custom dimensions, colors, outline toggle, debug toggle,
  and Reduce Motion.
- [ ] Implement reducer state as immutable `Paper` plus undo snapshots and
  render state; inject `ContinuousClock` and ID generation.
- [ ] Replace the placeholder buttons with actions that call the core model and
  drive the renderer. Use safe-area bottom controls, disabled undo state, and
  accessible text labels.
- [ ] Run reducer tests, UI tests, and full simulator suite.
- [ ] Commit `feat: add native controls and gestures`.

### Task 7: Add native gestures and accessibility parity

**Files:** create gesture adapter and input tests; expand XCUITests.

- [ ] Add red tests for one-finger movement, two-finger translation/rotation,
  active paper hit tests, keyboard Fold/Flip/Reset, and gestures locked during
  animation.
- [ ] Implement gestures in the canvas host with local/screen coordinate
  conversion. Respect Dynamic Type and Reduce Motion; expose VoiceOver labels,
  values, and hints for paper state and all controls.
- [ ] Automate settings, hinge controls, custom size, colors, orientation, and
  accessibility flows in XCUITest.
- [ ] Commit `feat: add accessible native gestures`.

### Task 8: Add motion and future fold-state clients

**Files:** create `MotionClient.swift`, `FoldStateClient.swift`, mocks and
`TestStore` coverage.

- [ ] Add red tests for lifecycle start/stop, denied/unavailable motion,
  deterministic default samples, mock fold samples, background cancellation,
  and software-fold fallback.
- [ ] Wrap exactly one `CMMotionManager` in an `AsyncStream`; cancel it during
  backgrounding and never expose a singleton to reducer state.
- [ ] Ship `FoldStateClient.unavailable` only; document public-API availability
  criteria without inspecting private device state. Availability-gate a future
  provider only after Apple publishes a public API.
- [ ] Commit `feat: add motion and future fold clients`.

### Task 9: Add consented analytics and privacy UI

**Files:** create analytics/privacy clients and views, policy/report documents,
and reducer/UI tests.

- [ ] Add red tests proving PostHog is not initialized before explicit consent,
  denied consent transmits nothing, and motion samples never reach analytics.
- [ ] Implement the existing web event schema, explicit consent prompt and
  preferences, disabled replay/autocapture, policy content/links, and an App
  Store privacy report. Keep the operator field configurable.
- [ ] Commit `feat: add consented analytics and privacy`.

### Task 10: Remove obsolete stacks only after native acceptance

**Files:** delete Node/Vite/Tauri/Rust/Android/PWA sources and generated web
assets; replace README and CI references with native instructions.

- [ ] Run the complete native simulator suite and manually exercise every row
  in `docs/native-rewrite-contract.md` first.
- [ ] Remove only files belonging to web, Tauri, Android, PWA, Gradle, pnpm,
  and generated web delivery. Retain source-attribution documentation and
  native textures/icons.
- [ ] Verify `rg --files` contains no obsolete build configuration and the
  Xcode project still generates/builds/tests from a clean checkout.
- [ ] Commit `chore: remove obsolete web and android stacks`.

### Task 11: Release guidance and quality gate

**Files:** add Apple release decision guide and CI quality jobs; run audits.

- [ ] Document individual/sole-proprietor versus Oy organization enrollment,
  seller-name implications, D-U-N-S applicability, and the fact that Google
  Play classification does not affect Apple enrollment. Do not enroll.
- [ ] Run SwiftUI, concurrency, Swift Testing, privacy, code-quality, and App
  Store readiness audits. Fix actual warnings, dead code, accessibility issues,
  unsafe isolation, and documentation gaps.
- [ ] On the booted iPhone 17 Pro / iOS 26.5 simulator, install/launch
  `eu.maxwase.kami`, capture each parity screenshot, execute all parity rows,
  and inspect `git status --short` for a clean worktree.
- [ ] Commit `docs: add apple release decision guide`, then
  `chore: complete native ios quality audit`.

## Final acceptance checklist

- [ ] Every source feature in the parity matrix works natively on the requested
  simulator, including software Fold when every sensor is unavailable.
- [ ] Core unit, reducer, snapshot/performance, and UI test suites pass with
  fresh `xcodebuild` evidence.
- [ ] The renderer meets the 97% perceptual and 1–64 face p95 requirements, or
  a MetalKit replacement meeting them exists behind the same `RenderFrame`.
- [ ] No private APIs, signing identity, secret, Apple account action, cloud
  feature, purchase, ad, remote push, merge, or rebase was introduced.
- [ ] The worktree is clean and `Kami.xcodeproj` regenerates using XcodeGen
  2.46.0.
