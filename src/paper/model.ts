import type { Vec2 } from "../math/vec2";

export type PaperSide = "front" | "back";

export interface PaperStyle {
  front: string;
  back: string;
  edge: string;
}

export interface Face {
  id: number;
  verts: Vec2[];
  up: PaperSide;
  layer: number;
  /** Outer surfaces toggle their visible side when folded. Inner surfaces (sandwiched) don't. */
  outer: boolean;
}

/** Single paper sheet composed of faces in local space. */
export interface Paper {
  id: number;
  style: PaperStyle;
  pos: Vec2;
  rot: number;
  scale: number;
  faces: Face[];
  baseW: number;
  baseH: number;
  isDragging: boolean;
}

export interface PaperSnapshot {
  pos: Vec2;
  rot: number;
  scale: number;
  faces: Face[];
}

export interface PaperFactory {
  nextFaceId: () => number;
  nextPaperId: () => number;
}

export function toggleSide(s: PaperSide): PaperSide {
  return s === "front" ? "back" : "front";
}

export function cloneFace(f: Face): Face {
  return {
    id: f.id,
    verts: f.verts.map((v) => ({ x: v.x, y: v.y })),
    up: f.up,
    layer: f.layer,
    outer: f.outer,
  };
}

export function snapshotPaper(p: Paper): PaperSnapshot {
  return {
    pos: { x: p.pos.x, y: p.pos.y },
    rot: p.rot,
    scale: p.scale,
    faces: p.faces.map(cloneFace),
  };
}

export function restorePaper(p: Paper, snap: PaperSnapshot): void {
  p.pos = { x: snap.pos.x, y: snap.pos.y };
  p.rot = snap.rot;
  p.scale = snap.scale;
  p.faces = snap.faces.map(cloneFace);
}

/** Create a centered rectangle face in local coords. */
export function makeRectFace(
  factory: PaperFactory,
  w: number,
  h: number,
  up: PaperSide,
  layer: number,
): Face {
  const hw = w / 2;
  const hh = h / 2;
  const verts: Vec2[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return { id: factory.nextFaceId(), verts, up, layer, outer: true };
}

/** Create a paper sheet with a single face. */
export function makePaper(
  factory: PaperFactory,
  style: PaperStyle,
  x: number,
  y: number,
  w: number,
  h: number,
): Paper {
  return {
    id: factory.nextPaperId(),
    style,
    pos: { x, y },
    rot: 0,
    scale: 1,
    faces: [makeRectFace(factory, w, h, "front", 0)],
    baseW: w,
    baseH: h,
    isDragging: false,
  };
}

export function resetPaper(p: Paper, factory: PaperFactory): void {
  p.faces = [makeRectFace(factory, p.baseW, p.baseH, "front", 0)];
  p.rot = 0;
  p.scale = 1;
}

/**
 * Flip the paper over horizontally (like turning a book page from right to left).
 * Mirrors around the paper's center along the screen-vertical axis, revealing the back side.
 */
export function flipPaper(p: Paper): void {
  // Find max layer for inversion
  let maxLayer = 0;
  for (const f of p.faces) {
    maxLayer = Math.max(maxLayer, f.layer);
  }

  // Compute the center of all faces for mirroring
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const f of p.faces) {
    for (const v of f.verts) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Flip axis is vertical in screen space, transform to local space
  // Axis direction in local space: (sin(rot), cos(rot))
  // Normal to axis (for reflection): (-cos(rot), sin(rot))
  const nx = -Math.cos(p.rot);
  const ny = Math.sin(p.rot);

  for (const f of p.faces) {
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
    // Toggle which side is facing up
    f.up = toggleSide(f.up);
    // Invert layer order: what was on bottom (layer 0) is now on top (highest layer)
    // what was on top (highest layer) is now on bottom (layer 0)
    f.layer = maxLayer - f.layer;
    // After flip, all faces are outer surfaces (no sandwiched inner surfaces)
    f.outer = true;
  }
}
