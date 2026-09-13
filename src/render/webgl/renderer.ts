import * as twgl from "twgl.js";
import { applyAffine } from "../../geom/affine";
import { easeInOutCubic } from "../../math/scalars";
import { norm2, type Vec2 } from "../../math/vec2";
import { mul3, rotateAroundAxis, v3, type Vec3 } from "../../math/vec3";
import type { FlipAnim } from "../../paper/flip";
import { FoldSide, type FoldAnim } from "../../paper/fold";
import type { Face, Paper, PaperSide } from "../../paper/model";
import {
  applyCrop,
  type Crop,
  calculateLighting,
  cropsForImages,
  LIGHTING_MIN_ALPHA,
  PATTERN_TINT_ALPHA,
  PERSPECTIVE_FACTOR,
} from "../paper";
import type { FrontImageSource } from "../textures";
import type { GL } from "./context";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";
import { TextureCache } from "./textures";
import {
  ATTRIBUTE_SPEC,
  MaterialMode,
  type Uniforms,
  VERTEX_COMPONENTS,
  VERTEX_STRIDE,
} from "./uniforms";

export type SideImages = Partial<Record<PaperSide, FrontImageSource>>;

/** Rigid rotation applied to a face, plus its resulting lighting normal. */
interface FacePose {
  axisPoint: Vec2;
  axisDir: Vec2;
  angle: number;
  normal: Vec3;
}

const FLAT_POSE: FacePose = {
  axisPoint: { x: 0, y: 0 },
  axisDir: { x: 1, y: 0 },
  angle: 0,
  normal: v3(0, 0, 1),
};

/** Uniforms constant across every face of one paper in one frame. */
type PaperUniforms = Pick<
  Uniforms,
  | "u_paperRot"
  | "u_paperScale"
  | "u_paperPos"
  | "u_bufferPx"
  | "u_dpr"
  | "u_perspectiveD"
  | "u_patternSize"
  | "u_tintAlpha"
>;

/** Everything drawFace needs that is shared across a paper's faces. */
interface PaperContext {
  paper: Paper;
  images: SideImages;
  crops: Record<PaperSide, Crop>;
  uniforms: PaperUniforms;
}

const otherSide = (side: PaperSide): PaperSide => (side === "front" ? "back" : "front");

/**
 * WebGL port of render/paper.ts's drawFlatPaperFaces / drawFoldingPaper /
 * drawFlippingPaper. Draw order reproduces the Canvas2D painter's sort exactly
 * (no depth buffer), and materials, cover-crop UVs, back-side mirroring and
 * lighting reuse the Canvas2D module's own helpers and constants.
 */
export class WebGLPaperRenderer {
  private readonly programInfo: twgl.ProgramInfo;
  private readonly bufferInfo: twgl.BufferInfo;
  private readonly textures: TextureCache;
  /** Fully transparent texel: an image material whose source has no pixels. */
  private readonly emptyTexture: WebGLTexture;
  private vertexData = new Float32Array(32 * VERTEX_COMPONENTS);
  private bufferPx: readonly [number, number] = [1, 1];
  private dpr = 1;

  constructor(
    private readonly gl: GL,
    private readonly patternSource: () => FrontImageSource,
  ) {
    const programInfo = twgl.createProgramInfo(gl, [VERTEX_SHADER, FRAGMENT_SHADER]);
    if (!programInfo) throw new Error("Paper shader failed to compile");
    this.programInfo = programInfo;

    const buffer = twgl.createBufferFromTypedArray(
      gl,
      this.vertexData,
      gl.ARRAY_BUFFER,
      gl.DYNAMIC_DRAW,
    );
    this.bufferInfo = { numElements: 0, attribs: interleavedAttribs(buffer) };
    this.textures = new TextureCache(gl);
    this.emptyTexture = twgl.createTexture(gl, { src: [0, 0, 0, 0] });

    // Single program and vertex layout for the renderer's lifetime.
    gl.useProgram(programInfo.program);
    twgl.setBuffersAndAttributes(gl, programInfo, this.bufferInfo);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  resize(bufferW: number, bufferH: number, dpr: number): void {
    this.bufferPx = [bufferW, bufferH];
    this.dpr = dpr;
    this.gl.viewport(0, 0, bufferW, bufferH);
  }

  beginFrame(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  endFrame(): void {
    this.textures.endFrame();
  }

  drawFlatPaperFaces(paper: Paper, images: SideImages): void {
    const pc = this.paperContext(paper, images);
    for (const f of [...paper.faces].sort((a, b) => a.layer - b.layer)) {
      this.drawFace(pc, f, f.up, FLAT_POSE);
    }
  }

  drawFoldingPaper(paper: Paper, anim: FoldAnim, images: SideImages): void {
    const pc = this.paperContext(paper, images);
    const progress = easeInOutCubic(anim.progress);
    const signedAngle = progress * Math.PI * (anim.foldSide === FoldSide.Front ? -1 : 1);
    const axisDir = norm2(anim.lineLocal.dir);
    const normalRot = rotateAroundAxis(
      v3(0, 0, 1),
      { x: axisDir.x, y: axisDir.y, z: 0 },
      signedAngle,
    );
    const viewingBackOfStack = progress > 0.5;
    const maxMovingLayer = anim.movingFaces.reduce((m, f) => Math.max(m, f.layer), 0);

    // Canvas2D sorts keep faces (z = 0) before the moving stack (forced z > 0,
    // see the long comment in drawFoldingPaper), each group by layer with a
    // stable sort — so the same two stable sorts reproduce its order.
    for (const f of [...anim.keepFaces].sort((a, b) => a.layer - b.layer)) {
      this.drawFace(pc, f, f.up, FLAT_POSE);
    }

    const movingPose: FacePose = {
      axisPoint: anim.lineLocal.p,
      axisDir,
      angle: signedAngle,
      normal: viewingBackOfStack ? mul3(normalRot, -1) : normalRot,
    };
    const effectiveLayer = (f: Face) =>
      viewingBackOfStack ? maxMovingLayer - f.layer : f.layer;
    for (const f of [...anim.movingFaces].sort(
      (a, b) => effectiveLayer(a) - effectiveLayer(b),
    )) {
      this.drawFace(pc, f, viewingBackOfStack ? otherSide(f.up) : f.up, movingPose);
    }
  }

  drawFlippingPaper(paper: Paper, anim: FlipAnim, images: SideImages): void {
    const pc = this.paperContext(paper, images);
    const progress = easeInOutCubic(anim.progress);
    const angle = -progress * Math.PI * anim.direction;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const f of anim.originalFaces) {
      for (const v of f.verts) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
    const axisDir =
      anim.axis === "vertical"
        ? { x: Math.cos(paper.rot), y: -Math.sin(paper.rot) }
        : { x: Math.sin(paper.rot), y: Math.cos(paper.rot) };
    const normalRot = rotateAroundAxis(v3(0, 0, 1), { ...axisDir, z: 0 }, angle);
    const viewingBackSide = normalRot.z < 0;

    const pose: FacePose = {
      axisPoint: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      axisDir,
      angle,
      normal: viewingBackSide ? mul3(normalRot, -1) : normalRot,
    };
    const renderLayer = (f: Face) => (viewingBackSide ? anim.maxLayer - f.layer : f.layer);
    // Canvas2D sorts by layer, then (stably) by render layer.
    const faces = [...anim.originalFaces]
      .sort((a, b) => a.layer - b.layer)
      .sort((a, b) => renderLayer(a) - renderLayer(b));
    for (const f of faces) {
      this.drawFace(pc, f, viewingBackSide ? otherSide(f.up) : f.up, pose);
    }
  }

  private paperContext(paper: Paper, images: SideImages): PaperContext {
    const pattern = this.patternSource();
    return {
      paper,
      images,
      crops: cropsForImages(paper, images),
      uniforms: {
        u_paperRot: paper.rot,
        u_paperScale: paper.scale,
        u_paperPos: [paper.pos.x, paper.pos.y],
        u_bufferPx: this.bufferPx,
        u_dpr: this.dpr,
        u_perspectiveD: 1 / PERSPECTIVE_FACTOR,
        u_patternSize: [pattern.width, pattern.height],
        u_tintAlpha: PATTERN_TINT_ALPHA,
      },
    };
  }

  private drawFace(pc: PaperContext, face: Face, side: PaperSide, pose: FacePose): void {
    const { verts } = face;
    if (verts.length < 3) return;
    const image = pc.images[side];

    // Fan-triangulate into the interleaved (localPos, uv) buffer.
    const vertexCount = (verts.length - 2) * 3;
    this.ensureCapacity(vertexCount);
    const data = this.vertexData;
    let o = 0;
    const push = (v: Vec2) => {
      const uv = image ? applyCrop(applyAffine(face.mat, v), pc.crops[side], side) : v;
      data[o++] = v.x;
      data[o++] = v.y;
      data[o++] = uv.x;
      data[o++] = uv.y;
    };
    for (let i = 1; i < verts.length - 1; i++) {
      push(verts[0]);
      push(verts[i]);
      push(verts[i + 1]);
    }

    const lighting = calculateLighting(pose.normal);
    const color = parseColor(side === "front" ? pc.paper.style.front : pc.paper.style.back);
    const uniforms: Uniforms = {
      ...pc.uniforms,
      u_axisPoint: [pose.axisPoint.x, pose.axisPoint.y],
      u_axisDir: [pose.axisDir.x, pose.axisDir.y],
      u_angle: pose.angle,
      u_mode: image ? MaterialMode.Image : MaterialMode.Pattern,
      u_texture: image
        ? image.width > 0 && image.height > 0
          ? this.textures.get(image, "image")
          : this.emptyTexture
        : this.textures.get(this.patternSource(), "pattern"),
      u_color: color.rgb,
      u_tintAlpha: pc.uniforms.u_tintAlpha * color.alpha,
      u_shadow: lighting.shadow > LIGHTING_MIN_ALPHA ? lighting.shadow : 0,
      u_highlight: lighting.highlight > LIGHTING_MIN_ALPHA ? lighting.highlight : 0,
    };

    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, o));
    twgl.setUniforms(this.programInfo, uniforms);
    twgl.drawBufferInfo(gl, this.bufferInfo, gl.TRIANGLES, vertexCount);
  }

  /** Grow the shared vertex buffer (CPU and GPU side) to fit `vertexCount`. */
  private ensureCapacity(vertexCount: number): void {
    const needed = vertexCount * VERTEX_COMPONENTS;
    if (needed <= this.vertexData.length) return;
    this.vertexData = new Float32Array(2 ** Math.ceil(Math.log2(needed)));
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);
  }
}

/** twgl attribute layout for one buffer interleaving ATTRIBUTE_SPEC in order. */
function interleavedAttribs(buffer: WebGLBuffer): Record<keyof typeof ATTRIBUTE_SPEC, twgl.AttribInfo> {
  let offset = 0;
  const entries = Object.entries(ATTRIBUTE_SPEC).map(([name, numComponents]) => {
    const info: twgl.AttribInfo = { buffer, numComponents, offset, stride: VERTEX_STRIDE };
    offset += numComponents * Float32Array.BYTES_PER_ELEMENT;
    return [name, info] as const;
  });
  return Object.fromEntries(entries) as Record<keyof typeof ATTRIBUTE_SPEC, twgl.AttribInfo>;
}

interface ParsedColor {
  rgb: readonly [number, number, number];
  alpha: number;
}

const colorCache = new Map<string, ParsedColor>();
let colorScratch: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS color to 0-1 RGB + alpha, exactly as Canvas2D would fill it. */
function parseColor(css: string): ParsedColor {
  const cached = colorCache.get(css);
  if (cached) return cached;
  if (colorScratch === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorScratch = canvas.getContext("2d", { willReadFrequently: true });
  }
  let parsed: ParsedColor = { rgb: [1, 1, 1], alpha: 1 };
  if (colorScratch) {
    colorScratch.clearRect(0, 0, 1, 1);
    colorScratch.fillStyle = css;
    colorScratch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorScratch.getImageData(0, 0, 1, 1).data;
    parsed = { rgb: [r / 255, g / 255, b / 255], alpha: a / 255 };
  }
  colorCache.set(css, parsed);
  return parsed;
}
