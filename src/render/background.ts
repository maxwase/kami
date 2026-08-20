/** Draw the wooden table background. */
export function drawTable(
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
