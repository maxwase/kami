import { clamp, easeInOutCubic } from "../math/scalars";
import { add2, mul2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { mul3, norm3, rotateAroundAxis, rotatePointAroundLine, v3 } from "../math/vec3";
import type { Vec3 } from "../math/vec3";
import { localToScreen, makeProjector } from "../paper/space";
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

const FLAT_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };

/** Face count above which one batched sheet fill beats per-face pattern fills. */
const BATCH_FACE_THRESHOLD = 8;

let tintCanvas: HTMLCanvasElement | undefined;
let tintCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Draw the paper's flat faces.
 *
 * A pattern fill carries large fixed per-call overhead - measured ~184x a solid
 * fill, and independent of the polygon's size - so issuing one per face made
 * this scale badly with fold depth. The texture is therefore filled exactly
 * once, clipped to the union of every face.
 *
 * Per-face colour is applied through a tint mask instead. Faces are painted
 * into the mask top layer first with source-over, so the topmost face wins each
 * pixel; that reproduces the old per-face draw order, where an upper face's
 * opaque texture fill covered everything beneath it. Lighting is constant for
 * flat faces, so it is applied once over the same clip.
 */
export function drawFlatPaperFaces(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  texture: CanvasPattern,
): void {
  if (paper.faces.length === 0) return;

  // The batched path costs a fixed full-sheet fill plus a composite, which only
  // pays off once enough faces are sharing it. Below the threshold, shading each
  // face directly is cheaper - an unfolded sheet is one large, cheap fill.
  if (paper.faces.length <= BATCH_FACE_THRESHOLD) {
    const projectFew = makeProjector(paper);
    const ordered = [...paper.faces].sort((a, b) => a.layer - b.layer);
    alignTextureToPaper(texture, paper);
    for (const f of ordered) {
      const color = f.up === "front" ? paper.style.front : paper.style.back;
      shadeFace(ctx, f.verts.map(projectFew), color, FLAT_NORMAL, texture);
    }
    return;
  }

  const t = ctx.getTransform();
  const sx = t.a || 1;
  const sy = t.d || 1;

  const project = makeProjector(paper);
  const byTop = [...paper.faces].sort((a, b) => b.layer - a.layer);
  const polys = byTop.map((f) => f.verts.map(project));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sv of polys) {
    for (const p of sv) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const viewW = ctx.canvas.width / sx;
  const viewH = ctx.canvas.height / sy;
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(viewW, Math.ceil(maxX) + 1);
  const y1 = Math.min(viewH, Math.ceil(maxY) + 1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const needW = Math.ceil(w * sx);
  const needH = Math.ceil(h * sy);

  if (!tintCanvas || tintCanvas.width < needW || tintCanvas.height < needH) {
    const prevW = tintCanvas?.width ?? 0;
    const prevH = tintCanvas?.height ?? 0;
    tintCanvas = document.createElement("canvas");
    tintCanvas.width = Math.max(needW, prevW);
    tintCanvas.height = Math.max(needH, prevH);
    tintCtx = tintCanvas.getContext("2d");
  }

  // Without a tint layer, fall back to shading each face on its own.
  if (!tintCtx) {
    for (let i = polys.length - 1; i >= 0; i--) {
      const f = byTop[i];
      const color = f.up === "front" ? paper.style.front : paper.style.back;
      shadeFace(ctx, polys[i], color, FLAT_NORMAL, texture);
    }
    return;
  }

  // Tint mask: painted top layer first so the topmost face wins each pixel.
  tintCtx.setTransform(1, 0, 0, 1, 0, 0);
  tintCtx.clearRect(0, 0, needW, needH);
  tintCtx.setTransform(sx, 0, 0, sy, -x0 * sx, -y0 * sy);
  for (let i = 0; i < polys.length; i++) {
    const f = byTop[i];
    tintCtx.fillStyle = f.up === "front" ? paper.style.front : paper.style.back;
    pathPoly(tintCtx, polys[i]);
    tintCtx.fill();
  }

  ctx.save();
  pathPolys(ctx, polys.map(orientCcw));
  ctx.clip();

  // One pattern fill for the whole sheet, instead of one per face.
  alignTextureToPaper(texture, paper);
  ctx.fillStyle = texture;
  ctx.fillRect(x0, y0, w, h);

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(tintCanvas, 0, 0, needW, needH, x0, y0, w, h);

  // Constant flat-face lighting, applied once over the same clip.
  ctx.globalCompositeOperation = "source-over";
  const { shadow, highlight } = calculateLighting(FLAT_NORMAL);
  if (shadow > 0.001) {
    ctx.globalAlpha = shadow;
    ctx.fillStyle = "#000";
    ctx.fillRect(x0, y0, w, h);
  }
  if (highlight > 0.001) {
    ctx.globalAlpha = highlight;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x0, y0, w, h);
  }
  ctx.restore();
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

  const projectPt = makeProjector(paper);

  // Add stationary (keep) faces - they remain flat at Z=0
  for (const f of anim.keepFaces) {
    const screenVerts = f.verts.map(projectPt);
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
    const screenVerts = projLocal.map(projectPt);

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

/**
 * Draw a subtle outline to indicate the active sheet.
 *
 * Face outlines overlap along shared creases, so they are stroked opaque into a
 * scratch layer and composited once at the target alpha - otherwise the shared
 * edges would stack and read darker than the outer boundary.
 *
 * The scratch layer covers only the paper's bounding box rather than the whole
 * viewport: the per-frame clear and composite dominate this function's cost, and
 * a full-screen version measured ~10x more expensive on WebKit than in Chrome.
 */
export function drawActiveOutline(ctx: CanvasRenderingContext2D, paper: Paper): void {
  if (paper.faces.length === 0) return;

  // Backing-store scale of the target, so the scratch layer matches its density.
  const t = ctx.getTransform();
  const sx = t.a || 1;
  const sy = t.d || 1;

  const projectOutline = makeProjector(paper);
  const polys: Vec2[][] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const f of paper.faces) {
    const sv = f.verts.map(projectOutline);
    polys.push(sv);
    for (const p of sv) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  // Pad for the stroke width, then clamp to the visible canvas.
  const pad = 2;
  const viewW = ctx.canvas.width / sx;
  const viewH = ctx.canvas.height / sy;
  const x0 = Math.max(0, Math.floor(minX - pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(viewW, Math.ceil(maxX + pad));
  const y1 = Math.min(viewH, Math.ceil(maxY + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const needW = Math.ceil(w * sx);
  const needH = Math.ceil(h * sy);

  // Grow-only: reuse the buffer across frames as the paper moves or rotates.
  if (!scratchCanvas || scratchCanvas.width < needW || scratchCanvas.height < needH) {
    const prevW = scratchCanvas?.width ?? 0;
    const prevH = scratchCanvas?.height ?? 0;
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = Math.max(needW, prevW);
    scratchCanvas.height = Math.max(needH, prevH);
    scratchCtx = scratchCanvas.getContext("2d");
  }
  if (!scratchCtx) return;

  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, needW, needH);
  // Map paper-space (CSS px) into the bounding-box-local scratch layer.
  scratchCtx.setTransform(sx, 0, 0, sy, -x0 * sx, -y0 * sy);

  const isWhite = paper.style.edge.includes("255");
  scratchCtx.strokeStyle = isWhite ? "#ffffff" : "#000000";
  scratchCtx.lineWidth = 1;
  const targetAlpha = isWhite ? 0.2 : 0.16;

  for (const sv of polys) {
    pathPoly(scratchCtx, sv);
    scratchCtx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = targetAlpha;
  ctx.drawImage(scratchCanvas, 0, 0, needW, needH, x0, y0, w, h);
  ctx.restore();
}

/**
 * Reverse a polygon's vertices if it is wound clockwise.
 *
 * Folding reflects faces, which flips their winding. Under the nonzero rule a
 * clip or fill built from mixed-winding polygons cancels where they overlap, so
 * every polygon must agree before they share a path.
 */
function orientCcw(verts: Vec2[]): Vec2[] {
  let twiceArea = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    twiceArea += p.x * q.y - q.x * p.y;
  }
  return twiceArea < 0 ? [...verts].reverse() : verts;
}

/** Build one path spanning several polygons, for a single clip or fill. */
function pathPolys(ctx: CanvasRenderingContext2D, polys: Vec2[][]): void {
  ctx.beginPath();
  for (const verts of polys) {
    if (verts.length === 0) continue;
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
  }
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
 * like turning a book page from right to left. At 90° the paper is edge-on,
 * then the back side becomes visible as it completes the 180° rotation.
 */
export function drawFlippingPaper(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  anim: FlipAnim,
  texture: CanvasPattern,
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

  // Compute rotated surface normal for lighting
  const baseNormal = v3(0, 0, 1);
  const normalRot = rotateAroundAxis(baseNormal, axisDir, angle);

  // Use the normal's z-component to determine which "side" we're viewing
  // This is the same threshold used for color switching
  const viewingBackSide = normalRot.z < 0;

  // Collect faces for rendering
  const items: RenderItem[] = [];
  const faces = [...anim.originalFaces].sort((a, b) => a.layer - b.layer);
  const projectPt = makeProjector(paper);

  for (const f of faces) {
    // Rotate each vertex around the Y axis
    const pts3 = f.verts.map((p) =>
      rotatePointAroundLine({ x: p.x, y: p.y, z: 0 }, axisPoint, axisDir, angle),
    );

    // Project 3D back to 2D with perspective
    const projLocal = pts3.map(project3To2Local);
    const screenVerts = projLocal.map(projectPt);

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

  // Sort by layer and render all faces
  // Layer inversion when viewing back side already handles correct stacking order
  items.sort((a, b) => a.layer - b.layer);

  for (const it of items) {
    shadeFace(ctx, it.screenVerts, it.color, it.normal, texture);
  }
}
