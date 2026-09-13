/** WebGL context creation: WebGL2 preferred, WebGL1 fallback. */
export type GL = WebGL2RenderingContext | WebGLRenderingContext;

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: true,
  depth: false,
  stencil: false,
  powerPreference: "high-performance",
};

export function createGLContext(canvas: HTMLCanvasElement): GL | null {
  return (
    canvas.getContext("webgl2", CONTEXT_ATTRIBUTES) ??
    canvas.getContext("webgl", CONTEXT_ATTRIBUTES)
  );
}

export function isWebGL2(gl: GL): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
}
