import { clamp, easeInOutCubic } from "../math/scalars";
import { add2, mul2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { mul3, norm3, rotateAroundAxis, rotatePointAroundLine, v3 } from "../math/vec3";
import type { Vec3 } from "../math/vec3";
import { localToScreen } from "../paper/space";
import type { Face, Paper, PaperSide } from "../paper/model";
import { FoldSide, type FoldAnim } from "../paper/fold";
import type { FlipAnim } from "../paper/flip";

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
): void {
  const faces = [...paper.faces].sort((a, b) => a.layer - b.layer);
  alignTextureToPaper(texture, paper);

  for (const f of faces) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    const color = f.up === "front" ? paper.style.front : paper.style.back;

    shadeFace(ctx, screenVerts, color, { x: 0, y: 0, z: 1 }, texture);
  }
}

/** Intermediate structure for Z-sorted rendering. */
interface RenderItem {
  screenVerts: Vec2[];
  zAvg: number;
  layer: number;
  color: string;
  normal: Vec3;
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

  // Use fold direction for consistent z sign (avoids floating-point instability near 0)
  // Add minimum value to ensure moving faces are always sorted separately from keep faces
  const zSign = anim.foldSide === FoldSide.Front ? 1 : -1;
  const stackZSigned = zSign * Math.max(stackZMax, 0.01);

  // Collect all faces into a single list for unified sorting
  const items: RenderItem[] = [];

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
    });
  }

  // Add moving faces with 3D rotation applied
  for (const { face: f, pts3 } of movingGeometry) {
    // Project 3D back to 2D with perspective
    const projLocal = pts3.map(project3To2Local);
    const screenVerts = projLocal.map((pl) => localToScreen(paper, pl));

    // During animation, ALL faces in the moving stack toggle at 90° - they
    // rotate together as a rigid body. (The outer flag only affects commit-time
    // behavior, not animation - it determines if `up` gets toggled when committed)
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

    items.push({
      screenVerts,
      zAvg: stackZSigned, // All moving faces use same z for coherent stack sorting
      layer: renderLayer,
      color,
      normal: visibleNormal,
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
    shadeFace(ctx, it.screenVerts, it.color, it.normal, texture);
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

/** Draw a polygon face with base color, optional texture, and lighting. */
function shadeFace(
  ctx: CanvasRenderingContext2D,
  screenVerts: Vec2[],
  baseColor: string,
  normal: Vec3,
  texture?: CanvasPattern,
): void {
  // Draw base color or texture
  if (texture) {
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
 * like turning a book page. At 90° the paper is edge-on, then the back
 * side becomes visible as it completes the 180° rotation.
 */
export function drawFlippingPaper(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  anim: FlipAnim,
  texture: CanvasPattern,
): void {
  alignTextureToPaper(texture, paper);

  // Compute eased rotation angle (0 to PI for full flip)
  const progress = easeInOutCubic(anim.progress);
  const angle = progress * Math.PI;

  // Rotation axis is the Y axis (vertical) at x=0 in local space
  const axisDir: Vec3 = { x: 0, y: 1, z: 0 };
  const axisPoint: Vec3 = { x: 0, y: 0, z: 0 };

  // Compute rotated surface normal for lighting
  const baseNormal = v3(0, 0, 1);
  const normalRot = rotateAroundAxis(baseNormal, axisDir, angle);

  // Use the normal's z-component to determine which "side" we're viewing
  // This is the same threshold used for color switching
  const viewingBackSide = normalRot.z < 0;

  // Collect faces for rendering
  const items: RenderItem[] = [];
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

    items.push({
      screenVerts,
      zAvg: 0, // Not used for sorting anymore
      layer: renderLayer,
      color,
      normal: visibleNormal,
    });
  }

  // Sort by layer
  items.sort((a, b) => a.layer - b.layer);

  // When viewing the back side, only render the top layer (center)
  // to prevent underlying faces from showing through
  if (viewingBackSide) {
    const maxLayer = Math.max(...items.map((it) => it.layer));
    const topFaces = items.filter((it) => it.layer === maxLayer);
    for (const it of topFaces) {
      shadeFace(ctx, it.screenVerts, it.color, it.normal, texture);
    }
  } else {
    for (const it of items) {
      shadeFace(ctx, it.screenVerts, it.color, it.normal, texture);
    }
  }
}
