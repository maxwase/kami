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
