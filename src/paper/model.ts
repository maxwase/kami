import type { Vec2 } from "../math/vec2";
import { baseLocalToUvAffine, type Mat2x3 } from "../geom/affine";

export type PaperSide = "front" | "back";

/**
 * Surface material applied to the front of the sheet:
 * - "color": the tiled paper pattern tinted by the front/back color pickers.
 * - "paper": the plain paper photo, UV-mapped so it folds for real.
 * - "banner": the Kami Play Store banner image, UV-mapped so it folds for real.
 *
 * "color" is the Color mode in the UI; "paper" and "banner" are the two options
 * under Texture mode.
 */
export type PaperMaterial = "color" | "paper" | "banner";

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
  /**
   * Affine map from this face's local coordinates to texture UV space ([0,1]
   * over the original sheet). Stays attached to the paper material through
   * clipping, reflection, and flipping so image textures fold for real.
   */
  mat: Mat2x3;
}

/** Single paper sheet composed of faces in local space. */
export interface Paper {
  id: number;
  style: PaperStyle;
  material: PaperMaterial;
  pos: Vec2;
  rot: number;
  scale: number;
  faces: Face[];
  baseW: number;
  baseH: number;
}

export interface PaperSnapshot {
  pos: Vec2;
  rot: number;
  scale: number;
  material: PaperMaterial;
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
    mat: { ...f.mat },
  };
}

export function snapshotPaper(p: Paper): PaperSnapshot {
  return {
    pos: { x: p.pos.x, y: p.pos.y },
    rot: p.rot,
    scale: p.scale,
    material: p.material,
    faces: p.faces.map(cloneFace),
  };
}

export function restorePaper(p: Paper, snap: PaperSnapshot): void {
  p.pos = { x: snap.pos.x, y: snap.pos.y };
  p.rot = snap.rot;
  p.scale = snap.scale;
  p.material = snap.material;
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
  return { id: factory.nextFaceId(), verts, up, layer, mat: baseLocalToUvAffine(w, h) };
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
    material: "color",
    pos: { x, y },
    rot: 0,
    scale: 1,
    faces: [makeRectFace(factory, w, h, "front", 0)],
    baseW: w,
    baseH: h,
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
