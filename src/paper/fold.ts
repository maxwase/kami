import { norm2, rotate2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { reflectPoint, makeLine } from "../geom/line2";
import type { Line2 } from "../geom/line2";
import { clipPolyHalfPlane, polyArea, signedPolyArea } from "../geom/polygon";
import { toggleSide } from "./model";
import type { Face, Paper, PaperSide } from "./model";
import { screenToLocal } from "./space";

/** Which side of the fold line moves. */
export enum FoldSide {
  Front = 1,
  Back = -1,
}

/** Animation data for an in-progress fold. */
export interface FoldAnim {
  /** Target paper identifier. */
  paperId: number;
  /** Normalized progress of the fold in [0,1]. */
  progress: number;
  /** Seconds the fold animation should take. */
  durationSeconds: number;
  /** Fold line in local space. */
  lineLocal: Line2;
  /** Which side of the line moves across. */
  foldSide: FoldSide;
  /** Faces that remain stationary. */
  keepFaces: Face[];
  /** Faces that move/flip during the fold. */
  movingFaces: Face[];
  /** Layer value for the newly folded faces. */
  foldedLayer: number;
}

export interface FoldBuildInput {
  /** Paper to fold. */
  paper: Paper;
  /** Fold line direction in screen space. */
  lineDirScreen: Vec2;
  /** Hinge position in screen space. */
  hingeScreen: Vec2;
  /** Optional override for which side moves. */
  foldSide?: FoldSide;
}

export interface FoldBuildDeps {
  nextFaceId: () => number;
}

export type FoldRejection =
  | "noIntersection"
  | "emptyMovingSide"
  | "emptyStationarySide";

export type FoldBuildResult =
  | { kind: "built"; anim: FoldAnim }
  | { kind: "rejected"; reason: FoldRejection };

/** Faces smaller than this area are discarded after clipping. */
const MIN_FACE_AREA = 4;

/** Default animation duration in seconds for fold transitions. */
const FOLD_DURATION_SECONDS = 0.46;

/** Precision multiplier for face vertex comparison (e.g., 100 = 2 decimal places). */
const FACE_KEY_PRECISION = 100;

/**
 * Determine which side of the fold line moves.
 * Returns +1 to always move the positive side of the line.
 */
export function determineFoldSide(lineDirScreen: Vec2, hingeScreen: Vec2): FoldSide {
  void lineDirScreen;
  void hingeScreen;
  return FoldSide.Front;
}

/**
 * Build a fold animation if the line splits the paper into two non-empty halves.
 * Returns a rejected result when the line does not meaningfully intersect faces.
 */
export function buildFoldAnim(
  input: FoldBuildInput,
  deps: FoldBuildDeps,
): FoldBuildResult {
  const { paper, lineDirScreen, hingeScreen } = input;

  const hingeLocal = screenToLocal(paper, hingeScreen);
  const lineDirLocal = norm2(rotate2(lineDirScreen, -paper.rot));
  const lineLocal = makeLine(hingeLocal, lineDirLocal);

  const foldSide: FoldSide =
    input.foldSide ?? determineFoldSide(lineDirScreen, hingeScreen);

  const keepFaces: Face[] = [];
  const movingFaces: Face[] = [];

  let maxLayer = 0;
  for (const f of paper.faces) maxLayer = Math.max(maxLayer, f.layer);
  const foldedLayer = maxLayer + 1;

  for (const f of paper.faces) {
    const pos = clipPolyHalfPlane(f.verts, lineLocal, 1);
    const neg = clipPolyHalfPlane(f.verts, lineLocal, -1);

    const posOk = polyArea(pos) > MIN_FACE_AREA;
    const negOk = polyArea(neg) > MIN_FACE_AREA;

    if (posOk) {
      const piece: Face = {
        id: deps.nextFaceId(),
        verts: pos,
        up: f.up,
        layer: f.layer,
        outer: f.outer,
      };
      (foldSide === FoldSide.Front ? movingFaces : keepFaces).push(piece);
    }
    if (negOk) {
      const piece: Face = {
        id: deps.nextFaceId(),
        verts: neg,
        up: f.up,
        layer: f.layer,
        outer: f.outer,
      };
      (foldSide === FoldSide.Back ? movingFaces : keepFaces).push(piece);
    }
  }

  if (movingFaces.length === 0 && keepFaces.length === 0) {
    return { kind: "rejected", reason: "noIntersection" };
  }
  if (movingFaces.length === 0) {
    return { kind: "rejected", reason: "emptyMovingSide" };
  }
  if (keepFaces.length === 0) {
    return { kind: "rejected", reason: "emptyStationarySide" };
  }

  return {
    kind: "built",
    anim: {
      paperId: paper.id,
      progress: 0,
      durationSeconds: FOLD_DURATION_SECONDS,
      lineLocal,
      foldSide,
      keepFaces,
      movingFaces,
      foldedLayer,
    },
  };
}

export function commitFold(
  paper: Paper,
  anim: FoldAnim,
  nextFaceId: () => number,
): void {
  const newFaces: Face[] = [];

  for (const f of anim.keepFaces) newFaces.push(f);

  // Compute max layer among moving faces for layer inversion
  let maxMovingLayer = 0;
  for (const f of anim.movingFaces) {
    maxMovingLayer = Math.max(maxMovingLayer, f.layer);
  }

  for (const f of anim.movingFaces) {
    const reflected = f.verts.map((p) => reflectPoint(p, anim.lineLocal));
    // All faces toggle their visible side when folded - the whole stack rotates
    // together, so we see the other side of every face after folding 180°
    const newUp: PaperSide = toggleSide(f.up);

    // When the stack folds over, the layer order inverts: what was on bottom
    // is now on top. Assign layers to reflect this physical stacking.
    const invertedLayer = maxMovingLayer - f.layer;
    const newLayer = anim.foldedLayer + invertedLayer;

    const nf: Face = {
      id: nextFaceId(),
      verts: reflected,
      up: newUp,
      layer: newLayer,
      // Newly folded faces become inner surfaces (their back is now sandwiched)
      outer: false,
    };
    newFaces.push(nf);
  }

  paper.faces = dedupeFaces(newFaces);
}

function dedupeFaces(faces: Face[]): Face[] {
  const seen = new Set<string>();
  const out: Face[] = [];
  for (const f of faces) {
    const key = faceKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function faceKey(face: Face): string {
  if (face.verts.length === 0) return `${face.up}:${face.layer}:empty`;
  const verts = normalizeVerts(face.verts);
  const parts = verts.map((v) => `${round2(v.x)},${round2(v.y)}`);
  return `${face.up}:${face.layer}:${parts.join("|")}`;
}

/**
 * Ensure polygon has counter-clockwise winding order.
 * Returns a new array with vertices in CCW order.
 */
function ensureCCW(verts: Vec2[]): Vec2[] {
  const area = signedPolyArea(verts);
  return area < 0 ? [...verts].reverse() : [...verts];
}

/**
 * Find the index of the lexicographically smallest vertex.
 * Compares by Y coordinate first, then X coordinate for ties.
 * Used to establish a canonical starting point for polygon comparison.
 */
function findLexicographicMinIndex(verts: Vec2[]): number {
  let minIdx = 0;
  for (let i = 1; i < verts.length; i++) {
    const curr = verts[i];
    const min = verts[minIdx];
    if (curr.y < min.y || (curr.y === min.y && curr.x < min.x)) {
      minIdx = i;
    }
  }
  return minIdx;
}

/**
 * Rotate array so element at startIdx becomes element 0.
 */
function rotateArray<T>(arr: T[], startIdx: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    out.push(arr[(startIdx + i) % arr.length]);
  }
  return out;
}

/**
 * Normalize polygon vertices for canonical comparison:
 * 1. Ensure counter-clockwise winding
 * 2. Rotate so lexicographically smallest vertex is first
 */
function normalizeVerts(verts: Vec2[]): Vec2[] {
  if (verts.length < 2) return verts;

  const ccw = ensureCCW(verts);
  const startIdx = findLexicographicMinIndex(ccw);
  return rotateArray(ccw, startIdx);
}

function round2(v: number): number {
  return Math.round(v * FACE_KEY_PRECISION) / FACE_KEY_PRECISION;
}
