<p align="center">
  <img src="public/icon.png" width="200">
</p>

<h1 align="center">Kami</h1>

<p align="center">
  <a href='https://play.google.com/store/apps/details?id=eu.maxwase.kami.twa'><img alt='Get it on Google Play' src='https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png' height="80"/></a>
</p>

Kami is a paper-folding simulation built to be driven by a physical hinge, using folding device APIs when available.

Try it online at https://kami.maxwase.eu

> [!IMPORTANT]
> [Posture API](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API) only works in a limited set of browsers! Check out the compatibility [here](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API#browser_compatibility).

## See it in action

https://github.com/user-attachments/assets/4016a644-f623-45a2-959b-9e070c18d7c2

# Features

- **Interactive Folding**: Fold paper using device posture (on supported devices), manual sliders, or on-screen controls.
- **Customization**: Choose from A4, Square, or a custom aspect ratio, and set independent front/back colors for a double-sided paper.
- **Motion Controls**:
  - **Rotate**: Use on-screen buttons or **Alt/Option + Drag** vertically to rotate the paper.
  - **Fold**: Trigger folds manually or let the physics engine handle it.
- **Realistic Visuals**:
  - WebGL renderer with a live Canvas2D fallback if the context is lost.
  - Wood and paper textures with graceful fallbacks if they fail to load.
  - Dynamic, soft shadows that react to lifting and folding.
  - Smooth animations for folding and rotation.

# Options

The game tries its best to auto-detect your device's folding posture and capabilities, but you can also manually set them using the "Show Options" button in the top-left.

1. **Invert fold direction** -- By default, Kami assumes the accelerometer is on the right half of the screen. It tries to detect the direction you fold your device (left to right, top to bottom, etc). If it guesses wrong, set it manually here.
2. **Stability threshold** -- This setting controls how sensitive posture detection is to small movements. A lower value means even small tilts count as a fold, while a higher value requires faster folds.
3. **X and Y axis** -- The problem of the century persists: Where is the center of the device?

## Installation

### macOS

1. Download the latest version for your Mac from the [releases](https://github.com/maxwase/kami/releases) page.
2. Unzip it
3. Install like any other dmg, drag the app into applications.

If you don't trust the GitHub actions output, consider building the app yourself — see [BUILDING.md](BUILDING.md).

### Android

Get it on Google Play (badge at the top of this page), or download the signed `kami-release.apk` (or `.aab`) from the [releases](https://github.com/maxwase/kami/releases) page.

### iOS

Not on the App Store yet. To run it on your own device or the simulator, build
it yourself — see [BUILDING.md](BUILDING.md#ios).

## Build and run

```sh
pnpm install
pnpm run dev
```

See [BUILDING.md](BUILDING.md) for requirements, production builds, native macOS/iOS builds, and releasing.

# Future of the project

I'm primarily a backend developer, so the code quality here is an ongoing journey.
I want to rewrite this in Rust, WebAssembly to make it cross-platform and to add more complex folding puzzles.

# Credits

- [Foldy bird](https://lyra.horse/fun/foldy-bird) -- Flappy bird controlled with hinge flaps! It's surprising how 2 people can independently come up with the same idea! Lyra, however, published it first, so congrats!
- [LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor) -- An amazing reversed-engineering of the MacBook's lid angle sensor, which inspired me to experiment with foldables!

If you have any thoughts or suggestions, please contact me via [telegram](https://t.me/maxwase) or [email](mailto:max.vvase@gmail.com) :)
