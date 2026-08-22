/**
 * The table background is fully static: it depends only on the viewport size
 * and the wood texture. Rebuilding it each frame costs a full-screen scaled
 * drawImage, ~h/6 alpha-blended scanlines and a full-screen radial gradient,
 * so it is rendered once into an offscreen canvas and blitted thereafter.
 */
let cache: HTMLCanvasElement | undefined;
let cacheW = 0;
let cacheH = 0;
let cacheWood: CanvasImageSource | undefined;

function paintTable(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wood: CanvasImageSource,
): void {
  ctx.drawImage(wood, 0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.08;
  const step = 6;
  for (let y = 0; y < h + step; y += step) {
    ctx.fillStyle = y % (step * 2) === 0 ? "#ffffff" : "#000000";
    ctx.fillRect(0, y, w, 1.2);
  }
  ctx.restore();

  ctx.save();
  const vg = ctx.createRadialGradient(
    w * 0.5,
    h * 0.55,
    0,
    w * 0.5,
    h * 0.55,
    Math.max(w, h) * 0.75,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Draw the wooden table background, reusing a cached render when possible. */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wood: CanvasImageSource,
): void {
  if (w <= 0 || h <= 0) return;

  if (!cache || cacheW !== w || cacheH !== h || cacheWood !== wood) {
    // Match the backing-store resolution of the target so the blit is 1:1.
    const t = ctx.getTransform();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * t.a));
    canvas.height = Math.max(1, Math.round(h * t.d));

    const cctx = canvas.getContext("2d", { alpha: false });
    if (!cctx) {
      // Cache unavailable; fall back to painting straight to the target.
      paintTable(ctx, w, h, wood);
      return;
    }
    cctx.setTransform(t.a, 0, 0, t.d, 0, 0);
    cctx.imageSmoothingEnabled = true;
    paintTable(cctx, w, h, wood);

    cache = canvas;
    cacheW = w;
    cacheH = h;
    cacheWood = wood;
  }

  ctx.drawImage(cache, 0, 0, w, h);
}

/** Drop the cached background, forcing a repaint on the next draw. */
export function invalidateTableCache(): void {
  cache = undefined;
  cacheWood = undefined;
}
