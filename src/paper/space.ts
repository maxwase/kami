import type { Vec2 } from "../math/vec2";
import { add2, mul2, rotate2, sub2 } from "../math/vec2";
import type { Paper } from "../paper/model";

/** Convert from local paper coords to screen coords. */
export function localToScreen(paper: Paper, p: Vec2): Vec2 {
  const scaled = mul2(p, paper.scale);
  const r = rotate2(scaled, paper.rot);
  return add2(r, paper.pos);
}

/** Convert from screen coords to local paper coords. */
export function screenToLocal(paper: Paper, p: Vec2): Vec2 {
  const d = sub2(p, paper.pos);
  const unscaled = mul2(d, 1 / paper.scale);
  return rotate2(unscaled, -paper.rot);
}
