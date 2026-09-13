import type { FlipAnim } from "../paper/flip";
import type { FoldAnim } from "../paper/fold";
import type { Paper } from "../paper/model";
import {
  drawActiveOutline,
  drawFlatPaperFaces,
  drawFlippingPaper,
  drawFoldingPaper,
  drawFoldLine,
} from "./paper";
import type { TextureSet } from "./textures";
import { createGLContext } from "./webgl/context";
import { type SideImages, WebGLPaperRenderer } from "./webgl/renderer";

/** What a paper is doing this frame. */
export type PaperMotion =
  | { kind: "flat" }
  | { kind: "fold"; anim: FoldAnim }
  | { kind: "flip"; anim: FlipAnim };

export interface PaperDraw {
  paper: Paper;
  motion: PaperMotion;
  images: SideImages;
  /** Stroke every face polygon (fold creases) over the settled sheet. */
  outline: boolean;
}

export interface Viewport {
  cssW: number;
  cssH: number;
  dpr: number;
  bufferW: number;
  bufferH: number;
}

export interface PaperRenderer {
  resize(view: Viewport): void;
  beginFrame(): void;
  /** Papers must be drawn bottom to top; the active paper last. */
  drawPaper(draw: PaperDraw): void;
  endFrame(): void;
}

/** The original renderer: papers drawn straight into the table's 2D canvas. */
class Canvas2DPaperRenderer implements PaperRenderer {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly textures: () => TextureSet,
  ) {}

  resize(): void {
    // The table canvas is sized by its owner.
  }

  beginFrame(): void {
    // Papers paint over the table drawn earlier this frame; nothing to clear.
  }

  endFrame(): void {
    // No per-frame resources.
  }

  drawPaper({ paper, motion, images, outline }: PaperDraw): void {
    const pattern = this.textures().paper;
    switch (motion.kind) {
      case "fold":
        drawFoldingPaper(this.ctx, paper, motion.anim, pattern, images);
        drawFoldLine(this.ctx, paper, motion.anim);
        break;
      case "flip":
        drawFlippingPaper(this.ctx, paper, motion.anim, pattern, images);
        break;
      case "flat":
        drawFlatPaperFaces(this.ctx, paper, pattern, images);
        break;
    }
    if (outline) drawActiveOutline(this.ctx, paper);
  }
}

/**
 * Papers on a transparent WebGL canvas above the table. The fold-line and
 * active-outline strokes stay Canvas2D (the same functions as the fallback)
 * on an overlay canvas above that; since the active paper is always the
 * topmost, drawing its strokes over every paper preserves Canvas2D's order.
 */
class WebGLPaperBackend implements PaperRenderer {
  private overlayDirty = true;

  constructor(
    private readonly gl: WebGLPaperRenderer,
    private readonly glCanvas: HTMLCanvasElement,
    private readonly overlay: CanvasRenderingContext2D,
  ) {}

  resize({ cssW, cssH, dpr, bufferW, bufferH }: Viewport): void {
    for (const canvas of [this.glCanvas, this.overlay.canvas]) {
      canvas.width = bufferW;
      canvas.height = bufferH;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    // Resizing resets the 2D context's transform and clears it.
    this.overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayDirty = false;
    this.gl.resize(bufferW, bufferH, dpr);
  }

  beginFrame(): void {
    this.gl.beginFrame();
    if (this.overlayDirty) {
      const { canvas } = this.overlay;
      this.overlay.save();
      this.overlay.setTransform(1, 0, 0, 1, 0, 0);
      this.overlay.clearRect(0, 0, canvas.width, canvas.height);
      this.overlay.restore();
      this.overlayDirty = false;
    }
  }

  drawPaper({ paper, motion, images, outline }: PaperDraw): void {
    switch (motion.kind) {
      case "fold":
        this.gl.drawFoldingPaper(paper, motion.anim, images);
        drawFoldLine(this.overlay, paper, motion.anim);
        this.overlayDirty = true;
        break;
      case "flip":
        this.gl.drawFlippingPaper(paper, motion.anim, images);
        break;
      case "flat":
        this.gl.drawFlatPaperFaces(paper, images);
        break;
    }
    if (outline) {
      drawActiveOutline(this.overlay, paper);
      this.overlayDirty = true;
    }
  }

  endFrame(): void {
    this.gl.endFrame();
  }
}

export interface PaperRendererCanvases {
  /** The table canvas's 2D context; the fallback draws papers here too. */
  ctx: CanvasRenderingContext2D;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  textures: () => TextureSet;
}

/**
 * WebGL with live demotion to Canvas2D. iOS drops GL contexts freely (app
 * backgrounded, memory pressure); on loss the fallback takes over from the
 * next frame so the papers never go blank, and on restore every GL resource
 * (program, buffers, textures) is rebuilt from the still-decoded images.
 */
class ContextLossAwareRenderer implements PaperRenderer {
  private active: PaperRenderer;
  private viewport: Viewport | undefined;

  constructor(
    initial: PaperRenderer,
    private readonly fallback: PaperRenderer,
    private readonly createWebGL: () => PaperRenderer | null,
    private readonly layers: readonly HTMLCanvasElement[],
    glCanvas: HTMLCanvasElement,
  ) {
    this.active = initial;
    glCanvas.addEventListener("webglcontextlost", (event) => {
      // Without preventDefault the browser never fires "restored".
      event.preventDefault();
      this.use(this.fallback);
    });
    glCanvas.addEventListener("webglcontextrestored", () => {
      const renderer = this.createWebGL();
      if (renderer) this.use(renderer);
    });
  }

  resize(view: Viewport): void {
    this.viewport = view;
    this.active.resize(view);
  }

  beginFrame(): void {
    this.active.beginFrame();
  }

  drawPaper(draw: PaperDraw): void {
    this.active.drawPaper(draw);
  }

  endFrame(): void {
    this.active.endFrame();
  }

  private use(renderer: PaperRenderer): void {
    this.active = renderer;
    const onGL = renderer !== this.fallback;
    for (const layer of this.layers) layer.hidden = !onGL;
    // Canvases may have been resized while the other renderer was active.
    if (this.viewport) renderer.resize(this.viewport);
  }
}

/**
 * Pick the paper renderer once at boot: WebGL when a context and the shader
 * are available, otherwise the Canvas2D renderer. The GL canvases stay hidden
 * unless WebGL is in use.
 */
export function createPaperRenderer({
  ctx,
  glCanvas,
  overlayCanvas,
  textures,
}: PaperRendererCanvases): PaperRenderer {
  const fallback = new Canvas2DPaperRenderer(ctx, textures);
  const gl = createGLContext(glCanvas);
  const overlay = overlayCanvas.getContext("2d");
  if (!gl || !overlay) return fallback;

  const createWebGL = (): PaperRenderer | null => {
    if (gl.isContextLost()) return null;
    try {
      const renderer = new WebGLPaperRenderer(gl, () => textures().paperImg);
      return new WebGLPaperBackend(renderer, glCanvas, overlay);
    } catch (err) {
      console.warn("WebGL paper renderer unavailable, using Canvas2D", err);
      return null;
    }
  };

  const initial = createWebGL();
  if (!initial) return fallback;
  const layers = [glCanvas, overlayCanvas];
  for (const layer of layers) layer.hidden = false;
  return new ContextLossAwareRenderer(initial, fallback, createWebGL, layers, glCanvas);
}
