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
  return { id: factory.nextFaceId(), verts, up, layer };
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
 * Flip the paper over by rotating 180° around the origin.
 * Left-top becomes right-bottom, revealing the other side.
 */
export function flipPaper(p: Paper): void {
  for (const f of p.faces) {
    // Rotate 180° around origin (negate both x and y)
    f.verts = f.verts.map((v) => ({ x: -v.x, y: -v.y }));
    // Toggle which side is facing up
    f.up = toggleSide(f.up);
    // Reset layer to 0 - after flip, all visible surfaces are "outer" surfaces
    // This ensures the fold logic treats them correctly
    f.layer = 0;
  }
}
