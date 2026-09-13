import type { Vec2 } from "../math/vec2";
import { dot2, mul2, norm2, perp2, sub2 } from "../math/vec2";

/** Infinite 2D line with a point, unit direction, and unit normal. */
export interface Line2 {
  /** Any point on the line. */
  p: Vec2;
  /** Unit direction vector along the line. */
  dir: Vec2;
  /** Unit outward normal (perp to dir). */
  n: Vec2;
}

/** Build a normalized line (unit dir and unit normal). */
export function makeLine(p: Vec2, dir: Vec2): Line2 {
  const d = norm2(dir);
  return { p, dir: d, n: perp2(d) };
}

/** Signed distance from point to line: positive on the line's normal side. */
export function signedDistanceToLine(p: Vec2, line: Line2): number {
  return dot2(sub2(p, line.p), line.n);
}

/** Reflect a point across an infinite line. */
export function reflectPoint(p: Vec2, line: Line2): Vec2 {
  const d = signedDistanceToLine(p, line);
  return sub2(p, mul2(line.n, 2 * d));
}
