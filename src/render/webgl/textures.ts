import * as twgl from "twgl.js";
import type { FrontImageSource } from "../textures";
import { type GL, isWebGL2 } from "./context";

/**
 * How a source is sampled: `image` is UV-mapped once across the sheet (clamped,
 * premultiplied so transparent pixels composite like Canvas2D's drawImage);
 * `pattern` tiles (REPEAT) like a CanvasPattern.
 */
export type TextureKind = "image" | "pattern";

/**
 * Largest texture edge uploaded. Bigger sources (a full-res camera photo picked
 * as a custom material) are downscaled first to bound GPU memory on iOS.
 */
const MAX_TEXTURE_EDGE = 2048;

/** Evict textures that haven't been drawn for this many frames. */
const EVICT_AFTER_FRAMES = 300;

interface Entry {
  texture: WebGLTexture;
  lastUsedFrame: number;
}

/**
 * Identity-keyed `FrontImageSource` → `WebGLTexture` cache. twgl creates the
 * textures but doesn't cache by source, and swapping a custom image would
 * otherwise leak the previous upload, so unused entries are evicted.
 */
export class TextureCache {
  private readonly entries: Record<TextureKind, Map<FrontImageSource, Entry>> = {
    image: new Map(),
    pattern: new Map(),
  };
  private frame = 0;

  constructor(private readonly gl: GL) {}

  get(source: FrontImageSource, kind: TextureKind): WebGLTexture {
    const map = this.entries[kind];
    const hit = map.get(source);
    if (hit) {
      hit.lastUsedFrame = this.frame;
      return hit.texture;
    }
    const texture =
      kind === "image" ? this.createImage(source) : this.createPattern(source);
    map.set(source, { texture, lastUsedFrame: this.frame });
    return texture;
  }

  endFrame(): void {
    this.frame += 1;
    for (const map of Object.values(this.entries)) {
      for (const [source, entry] of map) {
        if (this.frame - entry.lastUsedFrame > EVICT_AFTER_FRAMES) {
          this.gl.deleteTexture(entry.texture);
          map.delete(source);
        }
      }
    }
  }

  private createImage(original: FrontImageSource): WebGLTexture {
    const gl = this.gl;
    const source = this.limitSize(original);
    return twgl.createTexture(gl, {
      src: source,
      // Face UV v=0 is the image's top row, which is WebGL's unflipped order.
      flipY: 0,
      premultiplyAlpha: 1,
      wrap: gl.CLAMP_TO_EDGE,
      min: mipmapsAllowed(gl, source) ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      mag: gl.LINEAR,
    });
  }

  private createPattern(original: FrontImageSource): WebGLTexture {
    const gl = this.gl;
    const source = this.limitSize(original);
    // WebGL1 can only REPEAT power-of-two textures. Resample to POT; the shader
    // addresses the pattern by its original pixel size, so tiling is unchanged.
    const src =
      isWebGL2(gl) || isPowerOfTwo(source)
        ? source
        : resample(source, nextPowerOfTwo(source.width), nextPowerOfTwo(source.height));
    return twgl.createTexture(gl, {
      src,
      flipY: 0,
      premultiplyAlpha: 1,
      wrap: gl.REPEAT,
      min: gl.LINEAR_MIPMAP_LINEAR,
      mag: gl.LINEAR,
    });
  }

  /**
   * Downscale to fit MAX_TEXTURE_EDGE and the GPU's limit, keeping aspect.
   * UVs are normalized and crops use the original's aspect, so sampling is
   * unaffected apart from resolution.
   */
  private limitSize(source: FrontImageSource): FrontImageSource {
    const gpuMax = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const maxEdge = Math.min(MAX_TEXTURE_EDGE, gpuMax || MAX_TEXTURE_EDGE);
    const scale = maxEdge / Math.max(source.width, source.height);
    if (!(scale < 1)) return source;
    return resample(
      source,
      Math.max(1, Math.round(source.width * scale)),
      Math.max(1, Math.round(source.height * scale)),
    );
  }
}

function mipmapsAllowed(gl: GL, source: FrontImageSource): boolean {
  return isWebGL2(gl) || isPowerOfTwo(source);
}

function isPowerOfTwo(source: FrontImageSource): boolean {
  const pot = (n: number) => n > 0 && (n & (n - 1)) === 0;
  return pot(source.width) && pot(source.height);
}

function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

function resample(
  source: FrontImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}
