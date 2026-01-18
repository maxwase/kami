# Kami

<img src="public/icon.png" width="200">

Kami is a paper-folding simulation built to be driven by a physical hinge, using folding device APIs when available.

Try it online at https://maxwase.github.io/kami

!**important** [Posture API](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API) only works in a limited set of browsers! Check out the compatibility [here](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API#browser_compatibility).

## See it in action

https://github.com/user-attachments/assets/56427f60-d67c-44de-a087-7d626d0598f2

# Options

The game tries its best to auto-detect your device's folding posture and capabilities, but you can also manually set them using the "Show Options" button in the top-left.

1. Invert fold direction -- By default, Kami assumes the accelerometer is on the right half of the screen. It tries to detect the direction you fold your device (left to right, top to bottom, etc). If it guesses wrong, set it manually here.
2. Stability threshold -- This setting controls how sensitive posture detection is to small movements. A lower value means even small tilts count as a fold, while a higher value requires faster folds.
3. X and Y axis -- The problem of the century persists: Where is the center of the device?

## Requirements

- Node.js 18+ (Vite 7)
- pnpm 9+
- A modern [browser](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API) to actually test folding. Note that the API is only available on localhost or HTTPS connections.

## Build and run

### Web

```sh
pnpm install
pnpm run dev    # start Vite dev server
pnpm run build  # type-check + production build to dist/
```

### Native

To run it on MacOS do the following

```sh
pnpm install
pnpm run tauri dev    # start Vite dev server
pnpm tauri build --bundles app    # build an app
```


# Credits

- [Foldy bird](https://lyra.horse/fun/foldy-bird) -- Flappy bird controlled with hinge flaps! It's surprising how 2 people can independently come up with the same idea! Lyra, however, published it first, so congrats!
- [LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor) -- An amazing reversed-engineering of the MacBook's lid angle sensor, which inspired me to experiment with foldables!

# Future of the project

I'm primarily a backend developer, so the code quality here is probably not the best; a lot of it was AI-generated over a weekend.
I want to rewrite this in Rust, WebAssembly to make it cross-platform and to add more complex folding puzzles.
If you have any thoughts or suggestions, please contact me via [telegram](https://t.me/maxwase) or [email](mailto:max.vvase@gmail.com) :)
