import { lerp, EPS } from "../math/scalars";
import type { Vec2 } from "../math/vec2";
import { signedDistanceToLine } from "./line2";
import type { Line2 } from "./line2";

/**
 * Minimum distance between consecutive vertices before they collapse into one.
 * Prevents numerical instability from clipping operations that produce
 * near-coincident intersection points.
 */
const VERTEX_COLLAPSE_THRESHOLD = 0.25;

/**
 * Minimum cross product magnitude to consider three points non-collinear.
 * Vertices forming a near-straight line are removed to prevent degenerate spikes.
 */
const COLLINEARITY_THRESHOLD = 0.05;

/**
 * Clip polygon to the half-plane defined by a line.
 *
 * Implements the Sutherland-Hodgman algorithm for convex clipping:
 * - Iterates through each edge of the polygon
 * - For each edge, determines which vertices are inside the half-plane
 * - Computes intersection points where edges cross the clipping line
 * - Outputs the clipped polygon vertices
 *
 * For each edge (a -> b), there are 4 cases:
 * 1. Both inside: output b
 * 2. a inside, b outside: output intersection point
 * 3. a outside, b inside: output intersection point and b
 * 4. Both outside: output nothing
 *
 * @param poly Input polygon as array of vertices in order
 * @param line Clipping line with point, direction, and normal
 * @param keepSide Which side to keep: +1 for positive normal side, -1 for negative
 * @returns Clipped polygon vertices, or empty array if fully clipped away
 *
 * @see https://en.wikipedia.org/wiki/Sutherland%E2%80%93Hodgman_algorithm
 */
export function clipPolyHalfPlane(poly: Vec2[], line: Line2, keepSide: 1 | -1): Vec2[] {
  if (poly.length < 3) return [];

  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    const da = signedDistanceToLine(a, line) * keepSide;
    const db = signedDistanceToLine(b, line) * keepSide;

    const aIn = da >= -EPS;
    const bIn = db >= -EPS;

    if (aIn && bIn) {
      // Case 1: Both inside - output b
      out.push(b);
    } else if (aIn && !bIn) {
      // Case 2: a inside, b outside - output intersection
      const t = da / (da - db);
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    } else if (!aIn && bIn) {
      // Case 3: a outside, b inside - output intersection and b
      const t = da / (da - db);
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
      out.push(b);
    }
    // Case 4: Both outside - output nothing
  }

  return cleanupPoly(out);
}

/**
 * Remove consecutive near-coincident vertices from a polygon.
 * Handles numerical instability from line-polygon intersection calculations.
 */
function collapseNearbyVertices(poly: Vec2[]): Vec2[] {
  if (poly.length < 2) return poly;

  const out: Vec2[] = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    const dist = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : Infinity;
    if (dist > VERTEX_COLLAPSE_THRESHOLD) {
      out.push(p);
    }
  }

  // Check if first and last vertices should collapse (close the loop)
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < VERTEX_COLLAPSE_THRESHOLD) {
      out.pop();
    }
  }

  return out;
}

/**
 * Remove vertices that lie on a straight line between their neighbors.
 * Uses cross product to detect collinearity.
 */
function removeCollinearVertices(poly: Vec2[]): Vec2[] {
  if (poly.length < 3) return poly;

  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];

    // Vectors from curr to neighbors
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };

    // Cross product magnitude indicates deviation from collinearity
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (Math.abs(cross) > COLLINEARITY_THRESHOLD) {
      out.push(curr);
    }
  }

  return out;
}

/**
 * Clean polygon artifacts from clipping operations.
 * Applies two passes: collapse nearby vertices, then remove collinear ones.
 */
export function cleanupPoly(poly: Vec2[]): Vec2[] {
  if (poly.length < 3) return [];

  const collapsed = collapseNearbyVertices(poly);
  if (collapsed.length < 3) return [];

  const cleaned = removeCollinearVertices(collapsed);
  if (cleaned.length < 3) return [];

  return cleaned;
}

/**
 * Signed area of a polygon using the shoelace formula.
 * Returns positive for counter-clockwise winding, negative for clockwise.
 */
export function signedPolyArea(poly: Vec2[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum * 0.5;
}

/** Absolute area of a polygon. Returns 0 for degenerate polygons. */
export function polyArea(poly: Vec2[]): number {
  return Math.abs(signedPolyArea(poly));
}

/**
 * Determine if a point lies inside a polygon using the ray casting algorithm.
 *
 * Casts a horizontal ray from the test point toward +X infinity and counts
 * how many polygon edges it crosses. An odd count means inside (even-odd rule).
 *
 * The algorithm checks each edge to see if:
 * 1. The edge straddles the horizontal line through the test point
 * 2. The test point is to the left of the edge intersection
 *
 * @param pt Point to test
 * @param poly Polygon vertices in order (clockwise or counter-clockwise)
 * @returns true if point is strictly inside the polygon
 *
 * Note: Points exactly on an edge may return inconsistent results due to
 * floating-point precision. For robust edge detection, use a separate test.
 *
 * @see https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm
 */
export function pointInPoly(pt: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    // Check if edge straddles horizontal line and point is left of intersection
    const intersect =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y + EPS) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}
