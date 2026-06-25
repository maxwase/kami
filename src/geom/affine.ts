import type { Vec2 } from "../math/vec2";
import type { Line2 } from "./line2";

/**
 * 2D affine transform in DOMMatrix component order:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * Used to map a face's local coordinates to texture UV space (and to map
 * texture pixels to screen space when rendering). The map is intrinsic to the
 * paper material, so it survives clipping and composes cleanly with the
 * reflections produced by folding and flipping.
 */
export interface Mat2x3 {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Identity transform. */
export function identityAffine(): Mat2x3 {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** Apply an affine transform to a point. */
export function applyAffine(m: Mat2x3, p: Vec2): Vec2 {
  return {
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  };
}

/**
 * Compose two affine transforms: the result applies `inner` first, then `outer`
 * (i.e. result(p) = outer(inner(p))).
 */
export function composeAffine(outer: Mat2x3, inner: Mat2x3): Mat2x3 {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/**
 * Map local coordinates of the centered base rectangle to normalized UV
 * coordinates in [0,1].
 *
 * The banner texture is authored portrait (taller than wide). When the sheet is
 * oriented landscape (W > H) a direct mapping would squash the image, so the UV
 * is rotated 90° to align the image's long axis with the sheet's long axis. The
 * rotation has a positive determinant (a true rotation, not a mirror) so the
 * image is not flipped.
 */
export function baseLocalToUvAffine(baseW: number, baseH: number): Mat2x3 {
  if (baseW > baseH) {
    // Landscape sheet: u runs along the short (y) axis, v along the long (x)
    // axis, rotating the portrait image a quarter turn to fit.
    return { a: 0, b: -1 / baseW, c: 1 / baseH, d: 0, e: 0.5, f: 0.5 };
  }
  // Portrait/square sheet: direct mapping. u = (x + W/2)/W, v = (y + H/2)/H.
  return { a: 1 / baseW, b: 0, c: 0, d: 1 / baseH, e: 0.5, f: 0.5 };
}

/**
 * Reflection across an infinite line through `point` with unit normal `n`.
 * Matches the geometry produced by `reflectPoint`:
 *   reflect(p) = (I - 2·n·nᵀ)·p + 2·(n·point)·n
 */
function reflectAcross(point: Vec2, n: Vec2): Mat2x3 {
  const { x: nx, y: ny } = n;
  const dotNp = nx * point.x + ny * point.y;
  return {
    a: 1 - 2 * nx * nx,
    b: -2 * nx * ny,
    c: -2 * nx * ny,
    d: 1 - 2 * ny * ny,
    e: 2 * dotNp * nx,
    f: 2 * dotNp * ny,
  };
}

/** Affine reflection across a line, matching `reflectPoint(p, line)`. */
export function reflectionAffine(line: Line2): Mat2x3 {
  return reflectAcross(line.p, line.n);
}

/**
 * Affine mirror across a line through `center` with unit normal `normal`,
 * matching the vertex mirror performed in `commitFlip`.
 */
export function mirrorAffine(center: Vec2, normal: Vec2): Mat2x3 {
  return reflectAcross(center, normal);
}

/**
 * Solve the affine transform M with M·sᵢ = dᵢ for i in {0,1,2}.
 * Returns null when the source triangle is degenerate (near-collinear).
 */
export function affineFromTriangle(
  s0: Vec2,
  s1: Vec2,
  s2: Vec2,
  d0: Vec2,
  d1: Vec2,
  d2: Vec2,
): Mat2x3 | null {
  // Source edge basis (columns s1-s0, s2-s0).
  const sx0 = s1.x - s0.x;
  const sx1 = s2.x - s0.x;
  const sy0 = s1.y - s0.y;
  const sy1 = s2.y - s0.y;
  const det = sx0 * sy1 - sx1 * sy0;
  if (Math.abs(det) < 1e-9) return null;

  // Inverse of the source basis.
  const inv00 = sy1 / det;
  const inv01 = -sx1 / det;
  const inv10 = -sy0 / det;
  const inv11 = sx0 / det;

  // Dest edge basis (columns d1-d0, d2-d0).
  const dx0 = d1.x - d0.x;
  const dx1 = d2.x - d0.x;
  const dy0 = d1.y - d0.y;
  const dy1 = d2.y - d0.y;

  // Linear part A = Dx · Sx⁻¹.
  const a = dx0 * inv00 + dx1 * inv10;
  const c = dx0 * inv01 + dx1 * inv11;
  const b = dy0 * inv00 + dy1 * inv10;
  const d = dy0 * inv01 + dy1 * inv11;

  // Translation t = d0 - A·s0.
  const e = d0.x - (a * s0.x + c * s0.y);
  const f = d0.y - (b * s0.x + d * s0.y);

  return { a, b, c, d, e, f };
}
