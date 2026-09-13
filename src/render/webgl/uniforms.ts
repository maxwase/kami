/**
 * Single source of truth for the paper shader's uniforms and vertex
 * attributes. The GLSL declarations are generated from these specs and the
 * JS-side value types are derived from them, so a uniform/attribute name or
 * type can't drift between the shader source and the renderer.
 */

type GLSLUniformType = "int" | "float" | "vec2" | "vec3" | "sampler2D";

export const UNIFORM_SPEC = {
  // Geometry: fold/flip rotation about a local-space axis (angle 0 = flat).
  u_axisPoint: "vec2",
  u_axisDir: "vec2",
  u_angle: "float",
  // Paper placement (see paper/space.ts localToScreen).
  u_paperRot: "float",
  u_paperScale: "float",
  u_paperPos: "vec2",
  // Drawing buffer size in device px and the CSS→device px ratio, matching the
  // Canvas2D context's `setTransform(dpr, ...)`.
  u_bufferPx: "vec2",
  u_dpr: "float",
  u_perspectiveD: "float",
  // Material.
  u_mode: "int",
  u_texture: "sampler2D",
  u_patternSize: "vec2",
  u_color: "vec3",
  u_tintAlpha: "float",
  // Lighting overlay alphas (render/paper.ts calculateLighting).
  u_shadow: "float",
  u_highlight: "float",
} as const satisfies Record<`u_${string}`, GLSLUniformType>;

/** Vertex attributes, as component counts; interleaved in this order. */
export const ATTRIBUTE_SPEC = {
  a_localPos: 2,
  a_uv: 2,
} as const satisfies Record<`a_${string}`, 1 | 2 | 3 | 4>;

type JSValueFor<G extends GLSLUniformType> = G extends "vec2"
  ? readonly [number, number]
  : G extends "vec3"
    ? readonly [number, number, number]
    : G extends "sampler2D"
      ? WebGLTexture
      : number;

export type UniformName = keyof typeof UNIFORM_SPEC;

/** Compile-time-checked uniform bag for `twgl.setUniforms`. */
export type Uniforms = {
  [K in UniformName]: JSValueFor<(typeof UNIFORM_SPEC)[K]>;
};

/** `u_mode` values: how the face's base color is produced. */
export const MaterialMode = {
  /** Premultiplied image sampled at the face's cover-cropped UVs. */
  Image: 0,
  /** Screen-aligned repeating pattern, multiply-tinted by `u_color`. */
  Pattern: 1,
} as const;
export type MaterialMode = (typeof MaterialMode)[keyof typeof MaterialMode];

const GLSL_ATTRIBUTE_TYPE = { 1: "float", 2: "vec2", 3: "vec3", 4: "vec4" } as const;

export const UNIFORM_DECLARATIONS = Object.entries(UNIFORM_SPEC)
  .map(([name, type]) => `uniform ${type} ${name};`)
  .join("\n");

export const ATTRIBUTE_DECLARATIONS = Object.entries(ATTRIBUTE_SPEC)
  .map(([name, size]) => `attribute ${GLSL_ATTRIBUTE_TYPE[size]} ${name};`)
  .join("\n");

/** Bytes per interleaved vertex (all attributes are FLOAT). */
export const VERTEX_STRIDE =
  Object.values(ATTRIBUTE_SPEC).reduce<number>((sum, n) => sum + n, 0) *
  Float32Array.BYTES_PER_ELEMENT;

/** Float components per interleaved vertex. */
export const VERTEX_COMPONENTS = VERTEX_STRIDE / Float32Array.BYTES_PER_ELEMENT;
