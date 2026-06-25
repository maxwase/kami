import { clamp, easeInOutCubic } from "../math/scalars";
import { add2, mul2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { mul3, norm3, rotateAroundAxis, rotatePointAroundLine, v3 } from "../math/vec3";
import type { Vec3 } from "../math/vec3";
import { localToScreen } from "../paper/space";
import type { Face, Paper, PaperSide } from "../paper/model";
import { FoldSide, type FoldAnim } from "../paper/fold";
import type { FlipAnim } from "../paper/flip";
import { affineFromTriangle, applyAffine, type Mat2x3 } from "../geom/affine";

/**
 * Perspective foreshortening factor for 3D projection.
 * Higher values increase perspective distortion during folding.
 */
const PERSPECTIVE_FACTOR = 0.0022;

/**
 * Shadow intensity when face is angled away from light (0-1).
 * Applied as black overlay with alpha = (1 - NdotL) * SHADOW_INTENSITY.
 */
const SHADOW_INTENSITY = 0.28;

/**
 * Highlight intensity when face is angled toward light (0-1).
 * Applied as white overlay with alpha = NdotL * HIGHLIGHT_INTENSITY.
 */
const HIGHLIGHT_INTENSITY = 0.1;

/** Alpha value for the fold line indicator drawn during animation. */
const FOLD_LINE_ALPHA = 0.4;

/** Extension length for fold line rendering in each direction from hinge. */
const FOLD_LINE_EXTENT = 5000;

/** Light direction for shading (normalized toward upper-left-front). */
const LIGHT_DIR = norm3({ x: -0.35, y: -0.25, z: 0.9 });

/** Project local 3D point into local 2D with slight perspective. */
export function project3To2Local(p: Vec3): Vec2 {
  const persp = 1 / (1 + p.z * PERSPECTIVE_FACTOR);
  return { x: p.x * persp, y: p.y * persp };
}

export function drawFlatPaperFaces(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  texture: CanvasPattern,
  frontImage?: HTMLImageElement,
): void {
  const faces = [...paper.faces].sort((a, b) => a.layer - b.layer);
  alignTextureToPaper(texture, paper);
  const crop = frontImage ? coverCrop(paper, frontImage) : NO_CROP;

  for (const f of faces) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    const color = f.up === "front" ? paper.style.front : paper.style.back;
    const image = frontImageFor(f, f.up, frontImage, crop);

    shadeFace(ctx, screenVerts, color, { x: 0, y: 0, z: 1 }, texture, image);
  }
}

/** Image-texture fill data for a face: the source image and per-vertex UVs. */
interface FaceImage {
  img: HTMLImageElement;
  uvs: Vec2[];
}

/**
 * Sub-rectangle of an image (in [0,1] UV space) to sample, so the image covers
 * the sheet without distortion ("object-fit: cover"): a centered crop matching
 * the sheet's aspect rather than stretching the whole image to fill.
 */
interface Crop {
  u0: number;
  v0: number;
  su: number;
  sv: number;
}

const NO_CROP: Crop = { u0: 0, v0: 0, su: 1, sv: 1 };

/**
 * Compute the cover-crop for an image on a sheet. The material UV always runs
 * with u along the sheet's short side and v along its long side (see
 * baseLocalToUvAffine), so the target aspect is short/long. The image is cropped
 * (centered) to that aspect so it fills the sheet without being squashed.
 */
function coverCrop(paper: Paper, img: HTMLImageElement): Crop {
  if (img.width === 0 || img.height === 0) return NO_CROP;
  const target =
    Math.min(paper.baseW, paper.baseH) / Math.max(paper.baseW, paper.baseH);
  const imgAspect = img.width / img.height;
  if (imgAspect > target) {
    const su = target / imgAspect; // crop width
    return { u0: (1 - su) / 2, v0: 0, su, sv: 1 };
  }
  const sv = imgAspect / target; // crop height
  return { u0: 0, v0: (1 - sv) / 2, su: 1, sv };
}

/** Map a full-sheet UV into the cropped sub-rectangle of the image. */
function applyCrop(uv: Vec2, crop: Crop): Vec2 {
  return { x: crop.u0 + uv.x * crop.su, y: crop.v0 + uv.y * crop.sv };
}

/**
 * Resolve the texture-image fill for a face, if it should show one.
 * Only the visible front side shows the image; the back stays plain (pattern +
 * back color). UVs come from the face's material map applied to its local
 * vertices (then cover-cropped), so they stay correct through folds and flips.
 * `frontImage` is the image for the sheet's current texture material (banner or
 * plain paper), or undefined for the "color" material.
 */
function frontImageFor(
  face: Face,
  visibleSide: PaperSide,
  frontImage: HTMLImageElement | undefined,
  crop: Crop,
): FaceImage | undefined {
  if (!frontImage || visibleSide !== "front") return undefined;
  return {
    img: frontImage,
    uvs: face.verts.map((v) => applyCrop(applyAffine(face.mat, v), crop)),
  };
}

/** A small textured triangle: screen positions and matching image UVs. */
interface SubTri {
  s: [Vec2, Vec2, Vec2];
  uv: [Vec2, Vec2, Vec2];
}

/** Intermediate structure for Z-sorted rendering. */
interface RenderItem {
  screenVerts: Vec2[];
  zAvg: number;
  layer: number;
  color: string;
  normal: Vec3;
  /** Flat (affine-exact) image fill, used when the face is not rotating. */
  image?: FaceImage;
  /**
   * Perspective-correct image fill for rotating faces: a fine mesh of small
   * textured triangles. Drawn instead of `image`, followed by a single lighting
   * pass over `screenVerts` (lighting must not be applied per sub-triangle, or
   * the expanded clips would double-darken the seams into a visible grid).
   */
  subImage?: { img: HTMLImageElement; tris: SubTri[] };
}

/** Subdivisions per fan-triangle edge for perspective-correct texture mapping. */
const IMG_SUBDIV = 6;

/**
 * Subdivide a convex face (its local-space vertices) into a fine triangle mesh,
 * projecting each sub-vertex with `project` and computing its UV from the face's
 * material map. Each small triangle is projected with true perspective and then
 * mapped affinely, so the mesh approximates perspective-correct texturing and
 * avoids the keystone "stretch" a single affine per face shows under rotation.
 */
function subdivideFaceImage(
  localVerts: Vec2[],
  mat: Mat2x3,
  project: (p: Vec2) => Vec2,
  n: number,
  crop: Crop,
): SubTri[] {
  const tris: SubTri[] = [];
  const uvOf = (p: Vec2): Vec2 => applyCrop(applyAffine(mat, p), crop);
  const make = (a: Vec2, b: Vec2, c: Vec2): SubTri => ({
    s: [project(a), project(b), project(c)],
    uv: [uvOf(a), uvOf(b), uvOf(c)],
  });
  for (let k = 1; k < localVerts.length - 1; k++) {
    const A = localVerts[0];
    const B = localVerts[k];
    const C = localVerts[k + 1];
    const at = (i: number, j: number): Vec2 => ({
      x: A.x + ((B.x - A.x) * i + (C.x - A.x) * j) / n,
      y: A.y + ((B.y - A.y) * i + (C.y - A.y) * j) / n,
    });
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        tris.push(make(at(i, j), at(i + 1, j), at(i, j + 1)));
        if (i + j < n - 1) {
          tris.push(make(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)));
        }
      }
    }
  }
  return tris;
}

/** Draw one textured triangle, clipped to a slightly expanded triangle to hide seams. */
function drawImageTri(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s: [Vec2, Vec2, Vec2],
  uv: [Vec2, Vec2, Vec2],
): void {
  const iw = img.width;
  const ih = img.height;
  if (iw === 0 || ih === 0) return;
  const m = affineFromTriangle(
    { x: uv[0].x * iw, y: uv[0].y * ih },
    { x: uv[1].x * iw, y: uv[1].y * ih },
    { x: uv[2].x * iw, y: uv[2].y * ih },
    s[0],
    s[1],
    s[2],
  );
  if (!m) return;
  const prev = ctx.getTransform();
  ctx.save();
  const [e0, e1, e2] = expandTriangle(s[0], s[1], s[2], 0.5);
  ctx.beginPath();
  ctx.moveTo(e0.x, e0.y);
  ctx.lineTo(e1.x, e1.y);
  ctx.lineTo(e2.x, e2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(prev.multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f])));
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Render one Z-sorted item: plain/flat-image via shadeFace, or a subdivided image mesh. */
function drawRenderItem(
  ctx: CanvasRenderingContext2D,
  it: RenderItem,
  texture: CanvasPattern,
): void {
  if (it.subImage) {
    for (const t of it.subImage.tris) drawImageTri(ctx, it.subImage.img, t.s, t.uv);
    applyLightingOverlays(ctx, it.screenVerts, calculateLighting(it.normal));
    return;
  }
  shadeFace(ctx, it.screenVerts, it.color, it.normal, texture, it.image);
}

/**
 * Draw paper during a fold animation with 3D rotation effect.
 *
 * The 3D fold animation works as follows:
 * 1. Stationary faces are drawn flat (normal pointing up)
 * 2. Moving faces are rotated around the fold line axis using Rodrigues rotation
 * 3. Rotation angle is eased from 0 to PI (180 degrees) for a full fold
 * 4. Rotated 3D vertices are projected back to 2D with perspective
 * 5. Face visibility is determined by the rotated normal's Z component
 * 6. ALL faces are sorted together by Z depth for correct painter's algorithm rendering
 */
export function drawFoldingPaper(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  anim: FoldAnim,
  texture: CanvasPattern,
  frontImage?: HTMLImageElement,
): void {
  alignTextureToPaper(texture, paper);

  // === 3D Fold Rotation ===
  // Compute eased rotation angle (0 to PI for full fold)
  const progress = easeInOutCubic(anim.progress);
  const angle = progress * Math.PI;
  // Fold direction: negative for front-side fold (away from viewer)
  const signedAngle = angle * (anim.foldSide === FoldSide.Front ? -1 : 1);

  // Define 3D rotation axis along the fold line (in Z=0 plane)
  const axisDirLocal3 = norm3({
    x: anim.lineLocal.dir.x,
    y: anim.lineLocal.dir.y,
    z: 0,
  });
  const axisPointLocal3 = {
    x: anim.lineLocal.p.x,
    y: anim.lineLocal.p.y,
    z: 0,
  };

  // Compute rotated surface normal for lighting
  const baseNormal = v3(0, 0, 1);
  const normalRot = rotateAroundAxis(baseNormal, axisDirLocal3, signedAngle);

  // Past 90° rotation, we're viewing the "back" of the moving stack.
  // Use progress > 0.5 for a stable threshold (avoids floating-point issues with normalRot.z ≈ 0)
  const viewingBackOfStack = progress > 0.5;

  // Compute max layers for proper sorting
  const maxKeepLayer = anim.keepFaces.reduce((m, f) => Math.max(m, f.layer), 0);
  const maxMovingLayer = anim.movingFaces.reduce((m, f) => Math.max(m, f.layer), 0);

  // Pre-compute rotated geometry for all moving faces
  // We need a single representative z for the entire moving stack to ensure
  // it sorts as a coherent unit (the stack is a rigid body)
  const movingGeometry: { face: Face; pts3: Vec3[]; zAvg: number }[] = [];
  let stackZMax = 0;

  for (const f of anim.movingFaces) {
    const pts3 = f.verts.map((p) =>
      rotatePointAroundLine(
        { x: p.x, y: p.y, z: 0 },
        axisPointLocal3,
        axisDirLocal3,
        signedAngle,
      ),
    );
    const zAvg = pts3.reduce((s, p) => s + p.z, 0) / Math.max(1, pts3.length);
    stackZMax = Math.max(stackZMax, Math.abs(zAvg));
    movingGeometry.push({ face: f, pts3, zAvg });
  }

  // === Moving-stack depth: ALWAYS draw the moving stack above the keep faces ===
  //
  // Why this is forced positive (a deliberate fix, do not "improve" it back to a
  // geometry-derived sign):
  //
  // The fold model is "fold ONTO the top". `commitFold` always assigns the
  // folded flap the highest layer (foldedLayer = maxLayer + 1), so the final
  // flat render (drawFlatPaperFaces, sorted by layer) always draws the flap over
  // the stationary half. For the animation to be continuous with that committed
  // state, the moving stack must likewise be drawn above the keep faces for the
  // whole fold — hence a positive depth here, larger than the keep faces' z = 0.
  //
  // Two earlier approaches were wrong and produced visible artifacts once the
  // sheet carried an image texture (with plain paper both halves look identical,
  // so the bug was invisible):
  //
  //   1. Sign from `foldSide` (Front → +1, Back → −1). `foldSide` only encodes
  //      WHICH half moves, not which way the flap rotates in z. For one fold
  //      direction this put the moving stack BEHIND the keep half.
  //   2. Sign from the actual rotated z of the stack (its mean/representative
  //      depth). This is self-consistent within the animation, but for folds
  //      where the flap sweeps to negative z it draws the flap behind the keep
  //      half the entire fold — so the stationary image stays visible "through"
  //      the descending flap and then SNAPS to covered the instant commitFold
  //      runs and the flat render puts the flap on top. That snap is the "pop"
  //      / "shows through then disappears on re-render" symptom.
  //
  // Forcing positive removes the inconsistency: the flap occludes the keep image
  // gradually as it sweeps past 90° and the committed frame matches the last
  // animation frame, so there is no pop. During 0–90° the flap sits over the
  // moving side and does not overlap the keep faces, so drawing it on top there
  // is harmless. Internal ordering WITHIN the moving stack is handled separately
  // by renderLayer below. The min magnitude (0.01) keeps moving and keep faces
  // on distinct depths despite floating-point noise near the z ≈ 0 crossings
  // (fold start and end), where there is no overlap to mis-sort anyway.
  const stackZSigned = Math.max(stackZMax, 0.01);

  // Collect all faces into a single list for unified sorting
  const items: RenderItem[] = [];
  const crop = frontImage ? coverCrop(paper, frontImage) : NO_CROP;

  // Add stationary (keep) faces - they remain flat at Z=0
  for (const f of anim.keepFaces) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    const color = f.up === "front" ? paper.style.front : paper.style.back;
    items.push({
      screenVerts,
      zAvg: 0,
      layer: f.layer,
      color,
      normal: { x: 0, y: 0, z: 1 },
      image: frontImageFor(f, f.up, frontImage, crop),
    });
  }

  // Projector for the moving stack: rotate a local point about the fold axis,
  // apply perspective, then map to screen. Used to build a perspective-correct
  // texture mesh per face.
  const projectMoving = (p: Vec2): Vec2 =>
    localToScreen(
      paper,
      project3To2Local(
        rotatePointAroundLine(
          { x: p.x, y: p.y, z: 0 },
          axisPointLocal3,
          axisDirLocal3,
          signedAngle,
        ),
      ),
    );

  // Add moving faces with 3D rotation applied
  for (const { face: f, pts3 } of movingGeometry) {
    // Project 3D back to 2D with perspective
    const projLocal = pts3.map(project3To2Local);
    const screenVerts = projLocal.map((pl) => localToScreen(paper, pl));

    // During animation, ALL faces in the moving stack toggle at 90° - they
    // rotate together as a rigid body.
    const visibleSide: PaperSide = viewingBackOfStack
      ? f.up === "front"
        ? "back"
        : "front"
      : f.up;

    // Flip normal for lighting when viewing back of stack
    const visibleNormal: Vec3 = viewingBackOfStack ? mul3(normalRot, -1) : normalRot;
    const color = visibleSide === "front" ? paper.style.front : paper.style.back;

    // Compute render layer for sorting:
    // - Moving faces always end up on top of keep faces (they fold over)
    // - Past 90°, layer order inverts (bottom becomes top of the stack)
    const baseOffset = maxKeepLayer + 1;
    const effectiveLayer = viewingBackOfStack ? maxMovingLayer - f.layer : f.layer;
    const renderLayer = baseOffset + effectiveLayer;

    const subImage =
      frontImage && visibleSide === "front"
        ? {
            img: frontImage,
            tris: subdivideFaceImage(f.verts, f.mat, projectMoving, IMG_SUBDIV, crop),
          }
        : undefined;

    items.push({
      screenVerts,
      zAvg: stackZSigned, // All moving faces use same z for coherent stack sorting
      layer: renderLayer,
      color,
      normal: visibleNormal,
      subImage,
    });
  }

  // Sort for painter's algorithm (back-to-front rendering):
  // - Primary: sort by z depth (lower z = further from viewer, drawn first)
  // - Secondary: sort by layer (preserves stacking order for faces at same depth)
  const Z_EPSILON = 0.001;
  items.sort((a, b) => {
    const zDiff = a.zAvg - b.zAvg;
    if (Math.abs(zDiff) >= Z_EPSILON) {
      return zDiff; // Different z: sort by depth
    }
    return a.layer - b.layer; // Same z: preserve layer order
  });

  for (const it of items) {
    drawRenderItem(ctx, it, texture);
  }

  // Draw fold line indicator
  ctx.save();
  ctx.globalAlpha = FOLD_LINE_ALPHA;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;

  const aLocal = add2(anim.lineLocal.p, mul2(anim.lineLocal.dir, -FOLD_LINE_EXTENT));
  const bLocal = add2(anim.lineLocal.p, mul2(anim.lineLocal.dir, FOLD_LINE_EXTENT));
  const aS = localToScreen(paper, aLocal);
  const bS = localToScreen(paper, bLocal);

  ctx.beginPath();
  ctx.moveTo(aS.x, aS.y);
  ctx.lineTo(bS.x, bS.y);
  ctx.stroke();
  ctx.restore();
}

let scratchCanvas: HTMLCanvasElement | undefined;
let scratchCtx: CanvasRenderingContext2D | null | undefined;

/** Draw a subtle outline to indicate the active sheet. */
export function drawActiveOutline(ctx: CanvasRenderingContext2D, paper: Paper): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  if (
    !scratchCanvas ||
    scratchCanvas.width !== width ||
    scratchCanvas.height !== height
  ) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = width;
    scratchCanvas.height = height;
    scratchCtx = scratchCanvas.getContext("2d");
  }

  if (!scratchCtx) return;

  scratchCtx.clearRect(0, 0, width, height);

  // Determine opaque color and target alpha
  const isWhite = paper.style.edge.includes("255");
  scratchCtx.strokeStyle = isWhite ? "#ffffff" : "#000000";
  scratchCtx.lineWidth = 1;
  const targetAlpha = isWhite ? 0.2 : 0.16;

  for (const f of paper.faces) {
    const sv = f.verts.map((pt) => localToScreen(paper, pt));
    pathPoly(scratchCtx, sv);
    scratchCtx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = targetAlpha;
  ctx.drawImage(scratchCanvas, 0, 0);
  ctx.restore();
}

function pathPoly(ctx: CanvasRenderingContext2D, screenVerts: Vec2[]): void {
  if (screenVerts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(screenVerts[0].x, screenVerts[0].y);
  for (let i = 1; i < screenVerts.length; i++)
    ctx.lineTo(screenVerts[i].x, screenVerts[i].y);
  ctx.closePath();
}

/** Lighting values for shading a face. */
interface Lighting {
  shadow: number;
  highlight: number;
}

/**
 * Calculate shadow and highlight intensities from surface normal.
 * Uses Lambertian shading: intensity based on dot product with light direction.
 */
function calculateLighting(normal: Vec3): Lighting {
  const n = norm3(normal);
  const ndl = clamp(n.x * LIGHT_DIR.x + n.y * LIGHT_DIR.y + n.z * LIGHT_DIR.z, 0, 1);

  return {
    shadow: (1 - ndl) * SHADOW_INTENSITY,
    highlight: ndl * HIGHLIGHT_INTENSITY,
  };
}

/**
 * Apply lighting overlays to a polygon face.
 * Shadow and highlight are rendered as separate passes for proper blending.
 */
function applyLightingOverlays(
  ctx: CanvasRenderingContext2D,
  screenVerts: Vec2[],
  lighting: Lighting,
): void {
  const { shadow, highlight } = lighting;

  if (shadow > 0.001) {
    ctx.save();
    ctx.globalAlpha = shadow;
    ctx.fillStyle = "#000";
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();
  }

  if (highlight > 0.001) {
    ctx.save();
    ctx.globalAlpha = highlight;
    ctx.fillStyle = "#fff";
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();
  }
}

/** Draw a polygon face with base color, optional texture/image, and lighting. */
function shadeFace(
  ctx: CanvasRenderingContext2D,
  screenVerts: Vec2[],
  baseColor: string,
  normal: Vec3,
  texture?: CanvasPattern,
  image?: FaceImage,
): void {
  if (image) {
    // Image material: map the source image onto the face via its UVs.
    drawImageMappedPoly(ctx, image.img, screenVerts, image.uvs);
  } else if (texture) {
    ctx.save();
    ctx.fillStyle = texture;
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = baseColor;
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = baseColor;
    pathPoly(ctx, screenVerts);
    ctx.fill();
  }

  // Apply lighting
  const lighting = calculateLighting(normal);
  applyLightingOverlays(ctx, screenVerts, lighting);
}

/**
 * Draw an image mapped onto a convex polygon via per-vertex UV coordinates.
 *
 * The polygon is fan-triangulated; each triangle gets the affine transform that
 * maps its image-pixel UV triangle to its screen triangle, and the image is
 * drawn clipped to that triangle. An outer clip to the whole polygon plus a
 * small per-triangle outset prevents background bleed at the internal seams.
 *
 * Note: the affine per-triangle map cannot reproduce the perspective applied
 * during fold/flip animation, so the texture is mildly warped mid-animation;
 * the committed flat state is exact.
 */
function drawImageMappedPoly(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  screenVerts: Vec2[],
  uvs: Vec2[],
): void {
  if (screenVerts.length < 3 || uvs.length !== screenVerts.length) return;
  const iw = img.width;
  const ih = img.height;
  if (iw === 0 || ih === 0) return;

  const prev = ctx.getTransform();

  ctx.save();
  // Outer clip to the full polygon hides any sub-pixel triangle overspill.
  pathPoly(ctx, screenVerts);
  ctx.clip();

  for (let i = 1; i < screenVerts.length - 1; i++) {
    const d0 = screenVerts[0];
    const d1 = screenVerts[i];
    const d2 = screenVerts[i + 1];
    const s0 = { x: uvs[0].x * iw, y: uvs[0].y * ih };
    const s1 = { x: uvs[i].x * iw, y: uvs[i].y * ih };
    const s2 = { x: uvs[i + 1].x * iw, y: uvs[i + 1].y * ih };

    const m = affineFromTriangle(s0, s1, s2, d0, d1, d2);
    if (!m) continue;

    ctx.save();
    const [e0, e1, e2] = expandTriangle(d0, d1, d2, 0.5);
    ctx.beginPath();
    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.lineTo(e2.x, e2.y);
    ctx.closePath();
    ctx.clip();
    // Compose the triangle affine on top of the canvas DPR transform.
    ctx.setTransform(prev.multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f])));
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/** Expand a triangle outward from its centroid by `px` pixels per vertex. */
function expandTriangle(a: Vec2, b: Vec2, c: Vec2, px: number): [Vec2, Vec2, Vec2] {
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const push = (p: Vec2): Vec2 => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * px, y: p.y + (dy / len) * px };
  };
  return [push(a), push(b), push(c)];
}

export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=eu.maxwase.kami.twa";

function alignTextureToPaper(texture: CanvasPattern, paper: Paper): void {
  if (!("setTransform" in texture)) return;
  const m = new DOMMatrix();
  m.translateSelf(paper.pos.x, paper.pos.y);
  m.rotateSelf((paper.rot * 180) / Math.PI);
  m.scaleSelf(paper.scale, paper.scale);
  texture.setTransform(m);
}

/**
 * Draw paper during a flip animation with 3D rotation effect.
 *
 * The flip rotates the entire paper around the vertical Y axis (at x=0),
 * like turning a book page from right to left. At 90° the paper is edge-on,
 * then the back side becomes visible as it completes the 180° rotation.
 */
export function drawFlippingPaper(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  anim: FlipAnim,
  texture: CanvasPattern,
  frontImage?: HTMLImageElement,
): void {
  alignTextureToPaper(texture, paper);

  // Compute eased rotation angle (0 to -PI for full flip, right to left in screen space)
  const progress = easeInOutCubic(anim.progress);
  const angle = -progress * Math.PI;

  // Compute the center of all faces for the axis point
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const f of anim.originalFaces) {
    for (const v of f.verts) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Rotation axis should be vertical in SCREEN space (so flip is always right-to-left visually)
  // Transform screen vertical (0, 1) to local space by rotating by -paper.rot
  const axisDirLocal = {
    x: Math.sin(paper.rot),
    y: Math.cos(paper.rot),
  };
  const axisDir: Vec3 = { x: axisDirLocal.x, y: axisDirLocal.y, z: 0 };
  const axisPoint: Vec3 = { x: centerX, y: centerY, z: 0 };

  // Projector for the flip: rotate a local point about the flip axis, apply
  // perspective, then map to screen. Used to build a perspective-correct texture
  // mesh so the image does not stretch as the whole sheet swings out of plane.
  const projectFlip = (p: Vec2): Vec2 =>
    localToScreen(
      paper,
      project3To2Local(
        rotatePointAroundLine({ x: p.x, y: p.y, z: 0 }, axisPoint, axisDir, angle),
      ),
    );

  // Compute rotated surface normal for lighting
  const baseNormal = v3(0, 0, 1);
  const normalRot = rotateAroundAxis(baseNormal, axisDir, angle);

  // Use the normal's z-component to determine which "side" we're viewing
  // This is the same threshold used for color switching
  const viewingBackSide = normalRot.z < 0;

  // Collect faces for rendering
  const items: RenderItem[] = [];
  const crop = frontImage ? coverCrop(paper, frontImage) : NO_CROP;
  const faces = [...anim.originalFaces].sort((a, b) => a.layer - b.layer);

  for (const f of faces) {
    // Rotate each vertex around the Y axis
    const pts3 = f.verts.map((p) =>
      rotatePointAroundLine({ x: p.x, y: p.y, z: 0 }, axisPoint, axisDir, angle),
    );

    // Project 3D back to 2D with perspective
    const projLocal = pts3.map(project3To2Local);
    const screenVerts = projLocal.map((pl) => localToScreen(paper, pl));

    // Determine visible side: show other side when viewing back
    const visibleSide: PaperSide = viewingBackSide
      ? f.up === "front"
        ? "back"
        : "front"
      : f.up;

    // Flip normal for lighting when viewing back side
    const visibleNormal: Vec3 = viewingBackSide ? mul3(normalRot, -1) : normalRot;
    const color = visibleSide === "front" ? paper.style.front : paper.style.back;

    // Compute render layer: when viewing back, invert the layer order
    const renderLayer = viewingBackSide ? anim.maxLayer - f.layer : f.layer;

    const subImage =
      frontImage && visibleSide === "front"
        ? {
            img: frontImage,
            tris: subdivideFaceImage(f.verts, f.mat, projectFlip, IMG_SUBDIV, crop),
          }
        : undefined;

    items.push({
      screenVerts,
      zAvg: 0, // Not used for sorting anymore
      layer: renderLayer,
      color,
      normal: visibleNormal,
      subImage,
    });
  }

  // Sort by layer and render all faces
  // Layer inversion when viewing back side already handles correct stacking order
  items.sort((a, b) => a.layer - b.layer);

  for (const it of items) {
    drawRenderItem(ctx, it, texture);
  }
}
