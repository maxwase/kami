# Kami Native iPhone Rewrite Contract

## Product boundary

Kami is a native iPhone application for iOS 18 and later. This branch contains
only the native implementation; it has no web, Tauri, Android, or PWA product
surface. The bundle identifier is `eu.maxwase.kami`. FoldFlow is the product
brand. Distribution signing remains intentionally unset during development.

## Parity matrix

| Web behavior at `76ff4e7` | Native contract |
| --- | --- |
| A movable, rotatable, double-sided paper sheet | One value-semantic `Paper` rendered from immutable `RenderFrame` snapshots |
| Fold along a screen hinge or manual fallback | Software fold on every iPhone; optional public fold-state provider when Apple ships one |
| Face splitting, reflection, layer inversion, deduplication, reset and undo | `KamiCore` keeps complete polygons and rejects invalid geometry without mutation |
| Flip the complete paper stack | Native flip animation plus inverted layers and sides |
| A4, square, and custom paper dimensions | Validated aspect-ratio selection and safe-area-aware sizing |
| Front/back color, paper outline, texture, crease and shadow effects | Native renderer with cached textures and a Core Graphics proof backend |
| One-finger movement; two-finger movement and rotation; keyboard actions | SwiftUI gestures and iPad/iPhone hardware-key commands where available |
| Motion/posture controls with a manual Fold button | A lifecycle-managed `CMMotionManager` client with deterministic unavailable defaults; Fold always works |
| Settings, debug information, help, privacy choices, and links | Native sheets, Dynamic Type, VoiceOver labels, Reduce Motion, and consent-gated links/preferences |
| Explicit analytics consent and existing event names | PostHog starts only after consent; no session replay, autocapture, or motion-sample transmission |

## Modules and dependency pins

* `KamiCore`: paper identifiers, geometry, clipping, folding, flipping,
  animation values, undo, sizing, and immutable render frames.
* `KamiApp`: TCA state and reducers, SwiftUI UI, gestures, renderer host,
  motion/fold clients, analytics, privacy, and lifecycle.
* Tests: Swift Testing unit tests, SnapshotTesting image/performance coverage,
  and XCUITests.

The project is generated from XcodeGen **2.46.0** and pins
ComposableArchitecture **1.26.1**, PostHog **3.69.5**, SnapshotTesting
**1.19.2** (test targets), and SwiftLint **0.65.0**. Swift is 6.3 with strict
concurrency enabled. Xcode 26.6 with iOS SDK 26.5 is the intended build tool;
the minimum deployment target is iOS 18.0.

## Renderer acceptance criteria

The first renderer uses Core Graphics and real bundled textures. It must draw
perspective-projected faces, lighting, soft shadows, crease indicators, and
outlines from `RenderFrame` without capping, simplifying, or culling faces.
Reference scenes must achieve at least 97% perceptual snapshot precision and
meet these performance budgets without discarding geometry:

| Face count | p95 frame budget |
| --- | --- |
| 1–64 | < 16.7 ms |
| 65–256 | approximately 30 fps |
| >256 | all geometry retained; slower rendering permitted |

If the Core Graphics proof misses either the visual precision or the 1–64 face
performance gate, it is replaced by a MetalKit renderer behind the unchanged
`RenderFrame` contract. The renderer targets 60 fps through 64 faces and may
use 120 Hz only when its measured work fits the display budget.

## Privacy and release policy

`DEVELOPMENT_TEAM` is never committed. A developer may provide a local ignored
`Signing.xcconfig`; no certificate, team ID, D-U-N-S number, Apple credential,
or PostHog secret belongs in source control. Simulator and CI builds are
unsigned.

No Apple enrollment, App Store record, distribution signing, cloud storage,
ads, purchases, private APIs, submission, merge/rebase, or remote push is in
scope. The privacy policy operator remains configurable until release. An
individual enrollment would identify the proprietor's legal name trading as
FoldFlow; an organization path requires a separate legal entity and its
matching D-U-N-S record.
