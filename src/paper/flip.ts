import type { Paper } from "./model";
import { toggleSide } from "./model";
import { composeAffine, mirrorAffine } from "../geom/affine";

/** Animation duration for flip in seconds. */
const FLIP_DURATION_SECONDS = 0.5;

/** Visual sweep direction: 1 = right-to-left, -1 = left-to-right (or top-to-bottom/bottom-to-top for a vertical flip). */
export type FlipDirection = 1 | -1;

/** Screen-space axis the flip rotates/mirrors around. */
export type FlipAxis = "horizontal" | "vertical";

/** Animation data for an in-progress flip. */
export interface FlipAnim {
  /** Target paper identifier. */
  paperId: number;
  /** Normalized progress of the flip in [0,1]. */
  progress: number;
  /** Seconds the flip animation should take. */
  durationSeconds: number;
  /** Snapshot of faces before flip for animation. */
  originalFaces: Paper["faces"];
  /** Max layer before flip (for layer inversion). */
  maxLayer: number;
  /** Visual sweep direction: 1 = right-to-left, -1 = left-to-right. */
  direction: FlipDirection;
  /** Screen-space axis the flip rotates around. */
  axis: FlipAxis;
}

/** Build a flip animation for the given paper. */
export function buildFlipAnim(
  paper: Paper,
  direction: FlipDirection = 1,
  axis: FlipAxis = "horizontal",
): FlipAnim {
  let maxLayer = 0;
  for (const f of paper.faces) {
    maxLayer = Math.max(maxLayer, f.layer);
  }

  // Clone faces for animation reference
  const originalFaces = paper.faces.map((f) => ({
    id: f.id,
    verts: f.verts.map((v) => ({ x: v.x, y: v.y })),
    up: f.up,
    layer: f.layer,
    mat: { ...f.mat },
  }));

  return {
    paperId: paper.id,
    progress: 0,
    durationSeconds: FLIP_DURATION_SECONDS,
    originalFaces,
    maxLayer,
    direction,
    axis,
  };
}

/** Apply the final flipped state to the paper. */
export function commitFlip(paper: Paper, anim: FlipAnim): void {
  // Compute the center of all faces for mirroring
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const f of paper.faces) {
    for (const v of f.verts) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Flip axis is vertical (horizontal flip) or horizontal (vertical flip) in
  // screen space, transformed to local space. Normal to that axis is what we
  // mirror across.
  // Vertical axis local dir: (sin(rot), cos(rot)); normal: (-cos(rot), sin(rot))
  // Horizontal axis local dir: (cos(rot), -sin(rot)); normal: (sin(rot), cos(rot))
  const nx = anim.axis === "vertical" ? Math.sin(paper.rot) : -Math.cos(paper.rot);
  const ny = anim.axis === "vertical" ? Math.cos(paper.rot) : Math.sin(paper.rot);

  // Same mirror, expressed as an affine, so the material map stays in lockstep
  // with the mirrored geometry.
  const mirrorMat = mirrorAffine({ x: cx, y: cy }, { x: nx, y: ny });

  for (const f of paper.faces) {
    // Reflect each vertex across the axis line passing through (cx, cy)
    f.verts = f.verts.map((v) => {
      const dx = v.x - cx;
      const dy = v.y - cy;
      const dot = dx * nx + dy * ny;
      return {
        x: v.x - 2 * dot * nx,
        y: v.y - 2 * dot * ny,
      };
    });
    f.mat = composeAffine(f.mat, mirrorMat);
    // Toggle which side is facing up
    f.up = toggleSide(f.up);
    // Invert layer order: what was on bottom (layer 0) is now on top (highest layer)
    // what was on top (highest layer) is now on bottom (layer 0)
    f.layer = anim.maxLayer - f.layer;
  }
}
