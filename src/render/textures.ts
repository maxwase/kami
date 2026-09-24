/** An image source usable both by canvas patterns and as a UV-mapped fill. */
export type FrontImageSource = HTMLImageElement | HTMLCanvasElement;

export interface TextureSet {
  wood: CanvasImageSource;
  /** Tiled + tinted repeating pattern, used by material "color". */
  paper: CanvasPattern;
  /** Same paper photo as an image, UV-mapped for material "paper". */
  paperImg: FrontImageSource;
}

const LOAD_TIMEOUT_MS = 8000;
const WOOD_FALLBACK_COLOR = "#5b3a29";
const PAPER_FALLBACK_COLOR = "#f5f0e6";

/**
 * Load texture images and create repeating patterns when ready. Falls back
 * to a solid-color source if an image fails to load or takes too long, so a
 * flaky network request can never permanently block the render loop. The
 * banner is not loaded here — it's fetched lazily and on demand by
 * `loadBanner()` in ./banners, so a slow or missing banner asset can never
 * delay first paint.
 */
export async function loadTextures(ctx: CanvasRenderingContext2D): Promise<TextureSet> {
  const [wood, paperImg] = await Promise.all([
    loadImageWithFallback("textures/wood.jpg", WOOD_FALLBACK_COLOR),
    loadImageWithFallback("textures/paper.jpg", PAPER_FALLBACK_COLOR),
  ]);
  const paper = patternFromImage(ctx, paperImg, PAPER_FALLBACK_COLOR);
  return { wood, paper, paperImg };
}

function patternFromImage(
  ctx: CanvasRenderingContext2D,
  source: FrontImageSource,
  fallbackColor: string,
): CanvasPattern {
  const pattern = ctx.createPattern(source, "repeat");
  if (pattern) return pattern;
  // createPattern failing on a real image is exceptional; fall back to a
  // solid pattern rather than leaving the caller with nothing to draw.
  const fallbackPattern = ctx.createPattern(solidCanvas(fallbackColor), "repeat");
  if (!fallbackPattern) {
    throw new Error("Failed to create fallback pattern for textures/paper.jpg");
  }
  return fallbackPattern;
}

function solidCanvas(color: string, size = 64): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

export { LOAD_TIMEOUT_MS };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image at ${src}`));
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Texture load timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function loadImageWithFallback(
  src: string,
  fallbackColor: string,
): Promise<FrontImageSource> {
  try {
    return await withTimeout(loadImage(src), LOAD_TIMEOUT_MS);
  } catch {
    return solidCanvas(fallbackColor);
  }
}
