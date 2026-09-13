import { pointInPoly } from "../geom/polygon";
import type { Vec2 } from "../math/vec2";
import type { Paper } from "./model";
import { screenToLocal } from "./space";

/** True if the screen position lands inside any paper face (flat state). */
export function hitTestPaper(p: Paper, screen: Vec2): boolean {
  const local = screenToLocal(p, screen);
  for (const f of p.faces) {
    if (pointInPoly(local, f.verts)) return true;
  }
  return false;
}
