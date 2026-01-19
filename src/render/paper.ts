import { clamp, easeInOutCubic } from "../math/scalars";
import { add2, mul2, norm2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import { mul3, norm3, rotateAroundAxis, rotatePointAroundLine, v3 } from "../math/vec3";
import type { Vec3 } from "../math/vec3";
import { localToScreen } from "../paper/space";
import { toggleSide } from "../paper/model";
import type { Paper, PaperSide } from "../paper/model";
import type { FoldAnim } from "../paper/fold";

const PROJ_DIR = norm2({ x: 0.35, y: -0.65 });
const LIGHT_DIR = norm3({ x: -0.35, y: -0.25, z: 0.9 });

/** Project local 3D point into local 2D with slight perspective and lift. */
export function project3To2Local(p: Vec3): Vec2 {
  const persp = 1 / (1 + p.z * 0.0022);
  const lift = mul2(PROJ_DIR, p.z * 0.22);
  return { x: p.x * persp + lift.x, y: p.y * persp + lift.y };
}

export function drawFlatPaperFaces(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  texture: CanvasPattern,
): void {
  const faces = [...paper.faces].sort((a, b) => a.layer - b.layer);
  alignTextureToPaper(texture, paper);

  // Draw single consolidated shadow for all faces to avoid doubling
  if (faces.length > 0 && paper.shadowOpacity > 0.01) {
    // Get bounding vertices of all faces
    const allVerts: Vec2[] = [];
    for (const f of faces) {
      allVerts.push(...f.verts);
    }
    // Find convex hull or just use first face's verts as representative shadow
    const shadowVerts = faces[0].verts.map((p) => localToScreen(paper, p));
    drawShadow(ctx, shadowVerts, paper.shadowLiftZ, paper.shadowOpacity);
  }

  for (const f of faces) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    const color = f.up === "front" ? paper.style.front : paper.style.back;

    shadeFace(ctx, screenVerts, color, { x: 0, y: 0, z: 1 }, texture);

    ctx.save();
    ctx.strokeStyle = paper.style.edge;
    ctx.lineWidth = 1;
    pathPoly(ctx, screenVerts);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawFoldingPaper(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  anim: FoldAnim,
  texture: CanvasPattern,
): void {
  const keep = [...anim.keepFaces].sort((a, b) => a.layer - b.layer);
  alignTextureToPaper(texture, paper);
  
  for (const f of keep) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    drawShadow(ctx, screenVerts, 16);
  }
  for (const f of keep) {
    const screenVerts = f.verts.map((p) => localToScreen(paper, p));
    const color = f.up === "front" ? paper.style.front : paper.style.back;
    shadeFace(ctx, screenVerts, color, { x: 0, y: 0, z: 1 }, texture);

    ctx.save();
    ctx.strokeStyle = paper.style.edge;
    ctx.lineWidth = 1;
    pathPoly(ctx, screenVerts);
    ctx.stroke();
    ctx.restore();
  }

  const progress = easeInOutCubic(anim.progress);
  const angle = progress * Math.PI;

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

  const baseNormal = v3(0, 0, 1);
  const normalRot = rotateAroundAxis(baseNormal, axisDirLocal3, angle);

  const items = anim.movingFaces.map((f) => {
    const pts3 = f.verts.map((p) =>
      rotatePointAroundLine(
        { x: p.x, y: p.y, z: 0 },
        axisPointLocal3,
        axisDirLocal3,
        angle,
      ),
    );
    const zAvg = pts3.reduce((s, p) => s + p.z, 0) / Math.max(1, pts3.length);
    const projLocal = pts3.map(project3To2Local);
    const screenVerts = projLocal.map((pl) => localToScreen(paper, pl));

    const visibleSide: PaperSide = normalRot.z >= 0 ? f.up : toggleSide(f.up);
    const visibleNormal: Vec3 = normalRot.z >= 0 ? normalRot : mul3(normalRot, -1);
    const color = visibleSide === "front" ? paper.style.front : paper.style.back;

    return { screenVerts, zAvg, color, normal: visibleNormal };
  });

  items.sort((a, b) => a.zAvg - b.zAvg);

  for (const it of items) drawShadow(ctx, it.screenVerts, it.zAvg);

  for (const it of items) {
    shadeFace(ctx, it.screenVerts, it.color, it.normal, texture);

    ctx.save();
    ctx.strokeStyle = paper.style.edge;
    ctx.lineWidth = 1;
    pathPoly(ctx, it.screenVerts);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;

  const aLocal = add2(anim.lineLocal.p, mul2(anim.lineLocal.dir, -5000));
  const bLocal = add2(anim.lineLocal.p, mul2(anim.lineLocal.dir, 5000));
  const aS = localToScreen(paper, aLocal);
  const bS = localToScreen(paper, bLocal);

  ctx.beginPath();
  ctx.moveTo(aS.x, aS.y);
  ctx.lineTo(bS.x, bS.y);
  ctx.stroke();
  ctx.restore();
}

/** Draw a subtle outline to indicate the active sheet. */
export function drawActiveOutline(
  ctx: CanvasRenderingContext2D,
  paper: Paper,
  strokeStyle = "rgba(255,255,255,0.35)",
): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  for (const f of paper.faces) {
    const sv = f.verts.map((pt) => localToScreen(paper, pt));
    pathPoly(ctx, sv);
    ctx.stroke();
  }
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

function drawShadow(
  ctx: CanvasRenderingContext2D,
  screenVerts: Vec2[],
  zAvg: number,
  opacity: number = 1,
): void {
  const isDragging = zAvg > 25;
  const baseAlpha = clamp(zAvg / 220, 0, 1);
  const targetAlpha = isDragging ? baseAlpha * 0.95 * 2 : baseAlpha * 0.95;
  const a = targetAlpha * opacity;
  if (a < 0.01) return;

  const distanceMultiplier = isDragging ? 0.6 : 0.15;
  const off = { x: 0, y: zAvg * distanceMultiplier };

  ctx.save();
  ctx.translate(off.x, off.y);
  
  // Use canvas filter for true blur effect
  ctx.filter = 'blur(35px)';
  ctx.globalAlpha = Math.min(a, 1);
  ctx.fillStyle = "#000";
  pathPoly(ctx, screenVerts);
  ctx.fill();
  
  ctx.restore();
}

function shadeFace(
  ctx: CanvasRenderingContext2D,
  screenVerts: Vec2[],
  baseColor: string,
  normal: Vec3,
  texture?: CanvasPattern,
): void {
  const n = norm3(normal);
  const ndl = clamp(n.x * LIGHT_DIR.x + n.y * LIGHT_DIR.y + n.z * LIGHT_DIR.z, 0, 1);

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

  const dark = (1 - ndl) * 0.28;
  if (dark > 0.001) {
    ctx.save();
    ctx.globalAlpha = dark;
    ctx.fillStyle = "#000";
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();
  }

  const hi = ndl * 0.1;
  if (hi > 0.001) {
    ctx.save();
    ctx.globalAlpha = hi;
    ctx.fillStyle = "#fff";
    pathPoly(ctx, screenVerts);
    ctx.fill();
    ctx.restore();
  }
}

function alignTextureToPaper(texture: CanvasPattern, paper: Paper): void {
  if (!("setTransform" in texture)) return;
  const m = new DOMMatrix();
  m.translateSelf(paper.pos.x, paper.pos.y);
  m.rotateSelf((paper.rot * 180) / Math.PI);
  m.scaleSelf(paper.scale, paper.scale);
  texture.setTransform(m);
}
