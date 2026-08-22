import type { Vec2 } from "../math/vec2";
import { add2, mul2, rotate2, sub2 } from "../math/vec2";
import type { Paper } from "../paper/model";

/** Convert from local paper coords to screen coords. */
export function localToScreen(paper: Paper, p: Vec2): Vec2 {
  const scaled = mul2(p, paper.scale);
  const r = rotate2(scaled, paper.rot);
  return add2(r, paper.pos);
}

/**
 * Build a local→screen projector for one paper.
 *
 * `localToScreen` recomputes cos/sin per call, but the rotation is constant for
 * every vertex of a paper. Hoisting the trig out of the vertex loop keeps the
 * per-frame cost proportional to vertex count without the trig and intermediate
 * allocations, which matters once folds multiply the face count.
 */
export function makeProjector(paper: Paper): (p: Vec2) => Vec2 {
  const c = Math.cos(paper.rot);
  const s = Math.sin(paper.rot);
  const k = paper.scale;
  const ox = paper.pos.x;
  const oy = paper.pos.y;
  return (p: Vec2): Vec2 => {
    const x = p.x * k;
    const y = p.y * k;
    return { x: x * c - y * s + ox, y: x * s + y * c + oy };
  };
}

/** Convert from screen coords to local paper coords. */
export function screenToLocal(paper: Paper, p: Vec2): Vec2 {
  const d = sub2(p, paper.pos);
  const unscaled = mul2(d, 1 / paper.scale);
  return rotate2(unscaled, -paper.rot);
}
