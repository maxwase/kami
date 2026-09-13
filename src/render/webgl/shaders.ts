/**
 * One shader handles flat, folding, and flipping faces alike: a Rodrigues
 * rotation around an axis line (angle=0 for flat faces) done per-vertex, then a
 * true perspective divide via gl_Position.w so the rasterizer
 * perspective-corrects UV interpolation across each triangle — replacing the
 * CPU-side triangle subdivision (`subdivideFaceImage` in render/paper.ts) that
 * Canvas2D's affine-only `drawImage` needs to fake perspective.
 *
 * The projection exactly matches `project3To2Local` + `localToScreen`
 * (render/paper.ts, paper/space.ts):
 *   project3To2Local: persp = 1/(1 + z*k), local2 = (x,y)*persp
 *   localToScreen:    screen = R(paperRot) * (local2 * paperScale) + paperPos
 * With D = 1/k (so persp = D/(D+z)), setting
 *   clip.xy = paperScale * D * R(paperRot)*(x,y) + paperPos * (D+z)
 *   clip.w  = D + z
 * gives clip.xy/clip.w === localToScreen(project3To2Local((x,y,z))), and since
 * clip.w varies with z, interpolation is perspective-correct across the whole
 * triangle, not just at vertices.
 *
 * Output is premultiplied alpha (the GL canvas uses premultipliedAlpha and
 * blendFunc(ONE, ONE_MINUS_SRC_ALPHA)), so the lighting overlays composite
 * exactly like Canvas2D's source-over black/white fills — including over
 * transparent pixels of a custom image.
 */
import { ATTRIBUTE_DECLARATIONS, MaterialMode, UNIFORM_DECLARATIONS } from "./uniforms";

// Identical precision in both stages: uniforms shared by the two shaders must
// match, and mediump floats are 16-bit on Apple GPUs — far too coarse for
// screen-space pattern coordinates.
const PRECISION = `precision highp float;\nprecision highp int;`;

export const VERTEX_SHADER = `${PRECISION}
${ATTRIBUTE_DECLARATIONS}
${UNIFORM_DECLARATIONS}

varying vec2 v_uv;

void main() {
  vec3 axisP = vec3(u_axisPoint, 0.0);
  vec3 axisD = normalize(vec3(u_axisDir, 0.0));
  vec3 v = vec3(a_localPos, 0.0) - axisP;

  float c = cos(u_angle);
  float s = sin(u_angle);
  vec3 p3 = v * c + cross(axisD, v) * s + axisD * dot(axisD, v) * (1.0 - c) + axisP;

  float pc = cos(u_paperRot);
  float ps = sin(u_paperRot);
  vec2 rxy = vec2(p3.x * pc - p3.y * ps, p3.x * ps + p3.y * pc);

  float w = u_perspectiveD + p3.z;
  vec2 clipXY = u_paperScale * u_perspectiveD * rxy + u_paperPos * w;

  // clipXY/w is the CSS-px screen position (y-down); device px = css * dpr,
  // exactly as the Canvas2D context transform. Convert to clip space (y-up)
  // keeping the perspective divide intact:
  //   ndc.x = 2*dev.x/buf.x - 1  =>  gl.x = 2*dpr*clipXY.x/buf.x - w
  //   ndc.y = 1 - 2*dev.y/buf.y  =>  gl.y = w - 2*dpr*clipXY.y/buf.y
  vec2 dev = 2.0 * u_dpr * clipXY / u_bufferPx;
  gl_Position = vec4(dev.x - w, w - dev.y, 0.0, w);
  v_uv = a_uv;
}
`;

export const FRAGMENT_SHADER = `${PRECISION}
${UNIFORM_DECLARATIONS}

varying vec2 v_uv;

void main() {
  vec4 base;
  if (u_mode == ${MaterialMode.Image}) {
    base = texture2D(u_texture, v_uv);
  } else {
    // Canvas2D fills with a CanvasPattern whose transform is the paper's
    // pos/rot/scale (alignTextureToPaper), so the pattern is fixed to the
    // screen-space polygon rather than following the 3D rotation. Invert that
    // transform per fragment from the device-px fragment position.
    vec2 css = vec2(gl_FragCoord.x, u_bufferPx.y - gl_FragCoord.y) / u_dpr;
    vec2 d = css - u_paperPos;
    float pc = cos(u_paperRot);
    float ps = sin(u_paperRot);
    vec2 patternPx = vec2(d.x * pc + d.y * ps, -d.x * ps + d.y * pc) / u_paperScale;
    vec3 pattern = texture2D(u_texture, patternPx / u_patternSize).rgb;
    // "multiply" composite of the base color at globalAlpha = u_tintAlpha.
    base = vec4(pattern * mix(vec3(1.0), u_color, u_tintAlpha), 1.0);
  }
  // Source-over black at alpha u_shadow, then white at alpha u_highlight.
  vec4 shaded = base * (1.0 - u_shadow) + vec4(0.0, 0.0, 0.0, u_shadow);
  shaded = shaded * (1.0 - u_highlight) + vec4(u_highlight);
  gl_FragColor = shaded;
}
`;
