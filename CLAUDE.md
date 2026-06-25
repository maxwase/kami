# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install              # Install dependencies
pnpm run dev              # Start Vite dev server (web) at localhost:1420
pnpm run build            # TypeScript check + production build to dist/
pnpm run lint             # Run ESLint
pnpm run lint:fix         # Auto-fix ESLint issues
pnpm fmt                  # Format with Prettier
pnpm run tauri dev        # Start Tauri dev server (native macOS app)
pnpm tauri build --bundles app  # Build macOS app bundle
```

## Architecture Overview

Kami is an interactive paper-folding simulator that responds to physical device hinges (foldable phones, laptop lids). It runs as both a web app and a native macOS app via Tauri.

### Module Structure

- **`src/paper/`** - Paper model and fold physics
  - `model.ts`: Paper/Face data structures, undo snapshots, flip operation
  - `fold.ts`: Fold animation with Sutherland-Hodgman polygon clipping
  - `space.ts`: Local↔Screen coordinate transforms

- **`src/device/`** - Platform detection and sensor input
  - `runtime.ts`: Platform (Tauri/Web) and Device (Laptop/Phone) enums
  - `posture.ts`: Device Posture API integration with fallbacks
  - `hinge.ts`: Viewport segment parsing for foldable devices
  - `motion.ts`: Smoothed accelerometer tracking
  - `tauri.ts`: Bridge to Rust backend for macOS hinge sensor

- **`src/render/`** - Canvas 2D rendering
  - `paper.ts`: 3D paper rendering with perspective projection, shadows, highlights

- **`src/math/`** - Vector math (`Vec2`, `Vec3`) with `2`/`3` suffix convention
- **`src/geom/`** - Computational geometry (line intersection, polygon clipping)
- **`src/input/gestures.ts`** - Pointer events with gesture locking
- **`src/main.ts`** - Entry point, animation loop, UI binding

### Rust Backend (`src-tauri/`)

- `lib.rs`: Tauri commands for reading MacBook lid angle sensor via `hinge-angle` crate
- macOS-only; returns fallback on other platforms

### Data Flow

```
Device Sensors (Posture API / Tauri / Accelerometer)
    → Hinge Detection
    → Fold Trigger (on posture change)
    → buildFoldAnim (polygon clipping)
    → FoldAnim (eased progress 0→1)
    → Canvas Render (3D projection + lighting)
```

## Key Conventions

- **Coordinates**: `localToScreen()` / `screenToLocal()` for transforms
- **Vectors**: `Vec2 {x, y}` with functions like `add2`, `norm2`, `rotate2`
- **Factory pattern**: `PaperFactory` with `nextFaceId()`, `nextPaperId()` closures
- **Undo**: `snapshotPaper()` / `restorePaper()` for state management

## Fold Logic (Important)

The fold system uses layers to track paper stacking:

- **Layer 0**: Original unfolded paper - toggles visible side when folded
- **Layer > 0**: Already folded faces - inner surface stays hidden (doesn't toggle)

This prevents inner surfaces from becoming visible after multiple folds. The `commitFold` function in `fold.ts` and rendering logic in `render/paper.ts` both check `f.layer === 0` to determine fold behavior.

### Fold animation depth ordering (moving stack is ALWAYS on top)

`commitFold` always assigns the folded flap the highest layer (`foldedLayer = maxLayer + 1`), so after a fold the flat render draws the moving flap **on top of** the stationary ("keep") faces — the model only ever folds _onto the top_.

`drawFoldingPaper` must stay consistent with that committed state, so it sorts the moving stack above the keep faces for the entire animation: `stackZSigned = Math.max(stackZMax, 0.01)` (always positive; keep faces are at `z = 0`). Internal ordering _within_ the moving stack is handled separately by `renderLayer`.

Do **not** derive this depth sign from `foldSide` (which only says which half moves) or from the flap's actual rotated z. Either makes the flap render _behind_ the keep faces for some fold directions: the stationary texture then stays visible "through" the descending flap during the animation and **pops** to covered the instant `commitFold` runs. This was invisible with plain paper (both halves look identical) but obvious once a sheet carries an image texture. See the long comment at `stackZSigned` in `render/paper.ts` for the full rationale.

## Paper materials & textures

`Paper.material` (`"color" | "paper" | "banner"`, in `paper/model.ts`) selects the front surface:

- **`color`** — the tiled `paper.jpg` pattern tinted by the front/back color pickers (the UI "Color" mode).
- **`paper`** / **`banner`** — an image (plain paper photo / Kami Play Store banner) UV-mapped onto the sheet so it folds for real (the two "Texture" mode options).

Image textures fold correctly because each `Face` carries a `mat: Mat2x3` (`geom/affine.ts`) mapping its local coords to texture UV space. The map is intrinsic to the material: clipping leaves it unchanged, and folds/flips compose a reflection into it (`composeAffine`), so UVs stay attached to the paper. `render/paper.ts:drawImageMappedPoly` fan-triangulates each face and draws the image per triangle via an affine that composes onto the canvas DPR transform. `baseLocalToUvAffine` rotates the (portrait) image 90° on landscape sheets so it fills without squashing. Only `up === "front"` faces show the image; backs render plain.
