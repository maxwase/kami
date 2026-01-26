import { add2, mul2, rotate2, sub2 } from "../math/vec2";
import type { Vec2 } from "../math/vec2";
import type { Paper } from "../paper/model";
import { localToScreen } from "../paper/space";

export const InputLock = {
  Locked: "locked",
  Unlocked: "unlocked",
} as const;
export type InputLock = (typeof InputLock)[keyof typeof InputLock];

export interface GestureOptions {
  canvas: HTMLCanvasElement;
  getPaperAt: (screenPos: Vec2) => Paper | undefined;
  getActivePaper: () => Paper;
  setActivePaper: (paper: Paper) => void;
  bringPaperToTop: (paper: Paper) => void;
  getLockState: () => InputLock;
  useAltRotate?: boolean;
}

/**
 * Attach pointer handlers for drag and pinch-rotate gestures.
 * Returns a cleanup function for removing the listeners.
 */
export function attachGestureHandlers(opts: GestureOptions): () => void {
  const {
    canvas,
    getPaperAt,
    getActivePaper,
    setActivePaper,
    bringPaperToTop,
    getLockState,
    useAltRotate: useAltRotate = false,
  } = opts;

  interface PointerState {
    id: number;
    pos: Vec2;
  }
  const pointers = new Map<number, PointerState>();

  let dragOffset: Vec2 | undefined;
  let pinchLastMid: Vec2 | undefined;
  let pinchLastAngle = 0;
  let rotateStartAngle = 0;
  let rotateStartRot = 0;
  let rotatePointerId: number | undefined;
  let rotateAnchorLocal: Vec2 | undefined;
  let rotateAnchorScreen: Vec2 | undefined;

  const getPaperLocalCentroid = (paper: Paper): Vec2 => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const face of paper.faces) {
      for (const v of face.verts) {
        sumX += v.x;
        sumY += v.y;
        count += 1;
      }
    }
    if (count === 0) return { x: 0, y: 0 };
    return { x: sumX / count, y: sumY / count };
  };

  const getPointerPos = (e: PointerEvent): Vec2 => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (getLockState() === InputLock.Locked) return;

    canvas.setPointerCapture(e.pointerId);
    const pos = getPointerPos(e);
    pointers.set(e.pointerId, { id: e.pointerId, pos });

    const hit = getPaperAt(pos);
    if (hit) {
      setActivePaper(hit);
      bringPaperToTop(hit);
    }

    const paper = getActivePaper();

    if (pointers.size === 2) {
      const pts = Array.from(pointers.values()).map((s) => s.pos);
      const mid = mul2(add2(pts[0], pts[1]), 0.5);
      pinchLastMid = mid;
      pinchLastAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      dragOffset = undefined;
      return;
    }

    if (useAltRotate && e.altKey) {
      rotatePointerId = e.pointerId;
      rotateAnchorLocal = getPaperLocalCentroid(paper);
      rotateAnchorScreen = localToScreen(paper, rotateAnchorLocal);
      rotateStartAngle = Math.atan2(
        pos.y - rotateAnchorScreen.y,
        pos.x - rotateAnchorScreen.x,
      );
      rotateStartRot = paper.rot;
      dragOffset = undefined;
      return;
    }

    dragOffset = sub2(pos, paper.pos);
  };

  const onPointerMove = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    const pos = getPointerPos(e);
    state.pos = pos;

    const paper = getActivePaper();

    if (getLockState() === InputLock.Locked) return;

    if (pointers.size === 2 && pinchLastMid) {
      const pts = Array.from(pointers.values()).map((s) => s.pos);
      const mid = mul2(add2(pts[0], pts[1]), 0.5);
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

      let dAng = ang - pinchLastAngle;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;

      const dMid = sub2(mid, pinchLastMid);
      paper.pos = add2(paper.pos, dMid);
      paper.pos = add2(mid, rotate2(sub2(paper.pos, mid), dAng));
      paper.rot += dAng;

      pinchLastMid = mid;
      pinchLastAngle = ang;
      return;
    }

    if (
      useAltRotate &&
      rotatePointerId === e.pointerId &&
      rotateAnchorLocal &&
      rotateAnchorScreen
    ) {
      const ang = Math.atan2(
        pos.y - rotateAnchorScreen.y,
        pos.x - rotateAnchorScreen.x,
      );
      paper.rot = rotateStartRot + (ang - rotateStartAngle);
      const anchorOffset = rotate2(mul2(rotateAnchorLocal, paper.scale), paper.rot);
      paper.pos = sub2(rotateAnchorScreen, anchorOffset);
      return;
    }

    if (dragOffset) {
      paper.pos = sub2(pos, dragOffset);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);

    if (pointers.size < 2) {
      pinchLastMid = undefined;
    }

    if (rotatePointerId === e.pointerId) {
      rotatePointerId = undefined;
      rotateAnchorLocal = undefined;
      rotateAnchorScreen = undefined;
    }

    dragOffset = undefined;
  };

  const onPointerCancel = () => {
    pointers.clear();
    dragOffset = undefined;
    pinchLastMid = undefined;
    rotatePointerId = undefined;
    rotateAnchorLocal = undefined;
    rotateAnchorScreen = undefined;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}
