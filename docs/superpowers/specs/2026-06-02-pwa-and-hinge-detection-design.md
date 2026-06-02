# PWA + Reliable Hinge Detection — Design

Date: 2026-06-02
Branch: `google-analytics` (current working branch)

## Overview

Two independent changes to Kami, the device-posture origami simulator:

1. **PWA** — make the web build installable and offline-capable via `vite-plugin-pwa`.
2. **Reliable crease detection** — drive the fold crease line from the actual
   Viewport Segments instead of guessing from manual sliders, handle device
   orientation, and behave correctly across the device's open / creased / closed
   states.

The two are unrelated in code and could ship separately; they are specified
together because they were requested together and both target the on-device
foldable experience (tested via `adb reverse tcp:4173 tcp:4173` →
`pnpm preview` → `http://localhost:4173/kami/`).

## Goals

- App installs to a foldable Android home screen and runs offline (app shell).
- When the device is spanned across its hinge, the paper crease lands on the
  **physical** hinge gap — detected, not slider-guessed.
- Crease direction follows device orientation (landscape book = vertical crease,
  portrait book = horizontal crease) and updates on rotation.
- The app stays fully operable in all three device states; it never gets stuck
  mid-fold when the device closes.

## Non-goals

- Continuous hinge **angle** (0–180°) in the browser — no web API exposes it on
  Android; remains Tauri/macOS-only via the existing `hinge-angle` crate.
- Self-hosting the Material Symbols icon font (button glyphs stay
  Google-Fonts-loaded → broken offline; flagged as a known limitation).
- Any new test runner — the repo has none; verification is `build` + `lint` +
  on-device manual checks.
- Refactoring unrelated code.

---

## Section A — PWA via `vite-plugin-pwa`

### Approach
Add `vite-plugin-pwa` (devDependency) and the `VitePWA({...})` plugin to
`vite.config.js`. Workbox (bundled with the plugin) generates the service
worker and precaches Vite's hashed output, so the precache list never drifts
from the build. The plugin inherits Vite's `base`, so the `/kami/` GitHub Pages
path and `start_url`/`scope` resolve automatically.

### Configuration
- `registerType: 'autoUpdate'` — SW updates apply on next load, no prompt UI.
- **Disabled under Tauri**: gate the plugin behind the existing `isTauri` check
  in `vite.config.js` (Tauri loads from disk and needs no service worker).
- `manifest`:
  - `name: "kami: Origami simulator"`
  - `short_name: "kami"`
  - `description`: reuse the existing meta description.
  - `display: "standalone"`
  - `orientation: "any"` (foldables rotate and span freely)
  - `theme_color: "#201a14"`, `background_color: "#201a14"` (matches existing
    `<meta name="theme-color">`)
  - `icons`: the three generated icons below.
- `workbox.globPatterns`: precache local app shell — `**/*.{js,css,html,png,svg}`
  including `textures/`. External origins (Google Analytics, the silktide cookie
  banner, buymeacoffee, Google Fonts) are left network-only (no runtime caching).

### Icons
The existing `public/icons/` assets are platform-specific (Android `mipmap-*`,
iOS `AppIcon-*`) and not PWA-shaped. Generate three square PNGs from the
existing `public/icon.png` using macOS `sips` (no new dependency), commit to
`public/`:

- `public/pwa-192x192.png` (192×192)
- `public/pwa-512x512.png` (512×512)
- `public/pwa-maskable-512x512.png` (512×512, `purpose: "maskable"`)

The maskable icon may reuse the 512 square if `icon.png` has adequate safe-zone
padding; if it looks clipped on device, regenerate with padding (deferred until
the on-device check).

### Registration
The plugin auto-injects SW registration into the built `index.html`; no manual
service-worker file and no manual `<link rel="manifest">` are written by hand.

---

## Section B — Reliable crease + device states + orientation

### B0. Wire the dead dependency
`viewportsegments-polyfill` is already in `package.json` but **imported
nowhere**, so the Viewport Segments path in `hinge.ts` only fires on browsers
with native support. Fix:

- Move it from `devDependencies` to `dependencies` (it is a runtime polyfill).
- `import "viewportsegments-polyfill";` once at the top of `src/main.ts`.

This populates `window.viewport.segments` when the browser exposes the CSS
segment environment variables but not the JS API.

### B1. Three device states

Add `resolveHingeState(postureType, segments)` to `src/device/posture.ts`
returning a new `HingeState` enum:

| State | Condition | Crease source | Auto-fold | Buttons |
|-------|-----------|---------------|-----------|---------|
| `Flat` (open)    | posture `continuous`/`flat`/`unknown`, `<2` segments | manual sliders + orientation fallback | no | yes |
| `Creased` (book) | **`≥2` segments** | **detected gap center + direction** | **yes, on posture change** | yes |
| `Closed` (shut)  | posture `folded`/`half-opened`/`flipped`, `<2` segments | last-known / manual fallback | no | **yes (only fold path)** |

Resolution order: `segments.length >= 2` → `Creased`; else folded-type posture →
`Closed`; else → `Flat`.

**Behavior change:** auto-fold fires **only in `Creased`** — a real crease is
visible. This replaces the current `resolveFoldState` trigger
("folded posture OR `segments >= 2`"). Consequence: when the device closes and
exposes no segments, the app does **not** auto-fold and is never stuck mid-fold;
the user folds with the existing `Fold` button. `manualFoldQueued` (the button
path) keeps working in all three states. `resolveFoldState` is superseded by
`resolveHingeState` for the fold-trigger decision; the old function is removed if
it has no remaining callers (only its own change traces to this work).

### B2. Orientation

The segment-derived crease in `hinge.ts` is **orientation-correct by
construction**: `hingeDirFromSegments` already picks vertical vs horizontal from
`gapX`/`gapY`, and the new gap-center point is the midpoint of the real gap rect.
On rotation the segments swap and recompute. Therefore:

- **Segments win.** Remove the `main.ts` heuristic that hardcodes
  `{x:0, y:1}` for `phone + landscape` **when segments are present**. Keep that
  heuristic only as the `Flat`/`Closed` fallback (no segments), via the existing
  `fallbackHingeDir(getScreenAngleDeg(), w, h)`.
- Add rotation to the event-driven recompute (B-events below):
  `screen.orientation` `change` and the legacy `orientationchange`.

### B3. `HingeInfo` extension + crease position

Extend `HingeInfo` in `src/device/hinge.ts`:

```
export interface HingeInfo {
  segments: SegmentRect[];
  hingeDir: Vec2;
  hingePoint?: Vec2; // gap center in canvas CSS coords; undefined when <2 segments
}
```

Add a pure helper computing `hingePoint` = center of the gap between the two
outer segment rects (mirrors the existing `gapX`/`gapY` logic). Canvas covers the
viewport, so segment CSS coords map directly to canvas CSS coords.

### B4. `main.ts` integration

In `tick()`:
- Compute `state = resolveHingeState(postureType, hingeInfo.segments)`.
- `activeHinge` **position**: when `state === Creased` and `hingeInfo.hingePoint`
  exists, use `hingePoint`; otherwise `cssW/cssH * options.manualHingePos`
  (current behavior). Tauri-laptop branch unchanged.
- `activeHingeDir`: when segments present, use `hingeInfo.hingeDir`; otherwise the
  orientation fallback / manual flip (current behavior).
- `foldedNow`: auto-trigger only when `state === Creased`; OR `manualFoldQueued`
  in any state. (Drops the bare-`folded`-posture auto-trigger.)

### B5. Event-driven recompute

`computeHingePoint()` currently re-runs only on `window` `resize`, so segments go
stale mid-session. Add listeners that recompute `hingeInfo` (debounced/coalesced
to one recompute per frame is unnecessary — these events are infrequent):

- `window.visualViewport` `resize` and `scroll`
- `window.viewport` `change` (polyfill + native Viewport Segments)
- `navigator.devicePosture` `change`
- `screen.orientation` `change` and `window` `orientationchange`

Each handler calls the existing `computeHingePoint(cssW, cssH)` and stores the
result. Guard each listener with feature checks (objects may be absent).

### B6. Sliders + status

- **Sliders**: live in all states. In `Creased` their readout reflects the
  detected value; a user drag becomes a manual override until the state changes.
  Primary control in `Flat`/`Closed`.
- **Status**: `#debugStatus` shows the resolved `HingeState` and posture.
  `helpCopyForSupport` is extended to hint "device closed — use buttons" while in
  `Closed`.

### Unchanged
Accelerometer fold-side logic (`createMotionTracker`, `resolveFoldSide`) is
untouched.

---

## Data flow (after changes)

```
Device sensors
  (Device Posture API / Viewport Segments [+ polyfill] / orientation / accel / Tauri)
    → event-driven computeHingePoint()  → HingeInfo { segments, hingeDir, hingePoint }
    → resolveHingeState(posture, segments) → Flat | Creased | Closed
    → tick(): pick crease position/direction per state; auto-fold only if Creased
    → buildFoldAnim (polygon clipping)
    → FoldAnim → Canvas render
```

## Files touched

- `vite.config.js` — add `VitePWA`, gated by `isTauri`.
- `package.json` — add `vite-plugin-pwa`; move `viewportsegments-polyfill`
  devDep → dep.
- `public/` — add `pwa-192x192.png`, `pwa-512x512.png`,
  `pwa-maskable-512x512.png` (generated via `sips` from `icon.png`).
- `index.html` — only if the plugin needs a manual hook (theme-color meta
  already present; expected: no change or minimal).
- `src/device/hinge.ts` — `HingeInfo.hingePoint` + gap-center helper.
- `src/device/posture.ts` — `HingeState` enum + `resolveHingeState`; extend
  `helpCopyForSupport` for `Closed`.
- `src/main.ts` — import polyfill; state-driven crease position/direction;
  crease-only auto-fold; event-driven recompute listeners; remove
  segments-present landscape heuristic.

## Verification

No test runner exists in the repo. Success criteria:

1. `pnpm build` (tsc + vite) passes — PWA assets and SW emitted to `dist/`.
2. `pnpm lint` clean.
3. On-device (`pnpm build && pnpm preview`, `adb reverse tcp:4173 tcp:4173`,
   open `http://localhost:4173/kami/` on the foldable):
   - **Install**: Chrome offers Install / Add to home screen; DevTools
     Application → Manifest shows no errors; installed app launches standalone.
   - **Offline**: airplane mode → reload → app shell still loads and runs
     (icon-font glyphs may be missing — known limitation).
   - **Flat**: crease follows the X/Y sliders.
   - **Creased**: spanning the hinge snaps the crease onto the physical gap and
     auto-folds; survives portrait↔landscape rotation (crease re-orients).
   - **Closed**: device shut → no auto-fold, no stuck state; `Fold`/`Flip`/
     `Reset`/`Undo` buttons still work.

## Known limitations

- Material Symbols icon font is loaded from Google Fonts → button glyphs do not
  render offline. Self-hosting deferred.
- Continuous hinge angle remains unavailable on web (Tauri-only).
- `Closed`-vs-`Flat` distinction is best-effort: it relies on the Device Posture
  API reporting a folded-type posture; on devices that report only
  `continuous`/`folded`, a fully-shut device whose inner screen is off simply
  isn't rendering the app, so the distinction mostly matters for status display.

## Resolved decisions

- PWA implementation: `vite-plugin-pwa` (over hand-rolled).
- Hinge meaning: crease **line location** (over fold-state / angle).
- `display: standalone` (over `fullscreen`).
- Sliders stay live and reflect detected value (over hard-lock when detecting).
- Material Symbols offline breakage accepted for now.
