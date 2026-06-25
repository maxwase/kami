export interface TextureSet {
  wood: HTMLImageElement;
  /** Repeating paper pattern used for the "color" material (tiled + tinted). */
  paper: CanvasPattern;
  /** Paper photo as an image, for the "paper" texture material (UV-mapped). */
  paperImg: HTMLImageElement;
  banner: HTMLImageElement;
}

/**
 * Load texture images and create repeating patterns when ready.
 * Patterns become available asynchronously as images load.
 */
export async function loadTextures(ctx: CanvasRenderingContext2D): Promise<TextureSet> {
  const wood = await loadImage("textures/wood.jpg");
  const paperImg = await loadImage("textures/paper.jpg");
  const paper = ctx.createPattern(paperImg, "repeat");
  if (!paper) throw new Error("Failed to create pattern from textures/paper.jpg");
  const banner = await loadImage("textures/kami-playstore-banner.jpg");
  return { wood, paper, paperImg, banner };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image at ${src}`));
  });
}
