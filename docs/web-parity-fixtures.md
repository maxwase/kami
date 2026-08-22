# Web parity fixtures

`Tests/KamiCoreTests/Fixtures/web-parity.json` is the deterministic geometry
oracle transcribed from the fold, line, polygon, and paper-model behavior at
commit `76ff4e7`. Its two center-line folds cover both possible axis
orientations, clipping output, reflection, side toggling, and the first folded
layer.

The four render-scene descriptors are the stable native snapshot names. They
must be rendered using the bundled `paper.jpg` and `wood.jpg` textures and
compared to reference images generated from the same geometry. The fixture
does not preserve a browser canvas bitmap, because this branch will delete the
browser renderer; its numeric geometry is the durable cross-renderer oracle.

The original web motion semantics are retained as behavior rather than a web
runtime dependency: device acceleration is smoothed, unavailable permission
falls back deterministically, and a manual software fold remains available.
This aligns with Capacitor's iOS motion model while avoiding a Capacitor or web
view wrapper in the native app.
