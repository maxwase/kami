import { trackEvent } from "../analytics";
import type { Vec2 } from "../math/vec2";
import { add2, mul2, rotate2, sub2 } from "../math/vec2";
import type { FlipAxis, FlipDirection } from "../paper/flip";
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
  onFlip?: (direction: FlipDirection, axis: FlipAxis) => void;
  onTap?: () => void;
}

const SWIPE_FLIP_THRESHOLD_PX = 120;
// A pointerdown/up pair within this movement and duration counts as a tap
// rather than a drag.
const TAP_MAX_MOVE_PX = 6;
const TAP_MAX_DURATION_MS = 300;
// Gap that separates one physical swipe from the next, for accumulation purposes only.
const SWIPE_SEGMENT_QUIET_MS = 100;
// Cooldown after a flip fires before another swipe can trigger one. Scheduled
// once per trigger and never renewed by later wheel events, so a momentum
// tail arriving in dense sub-100ms bursts can't starve it from ever firing
// (that starvation was the "stops working after a couple of swipes" bug).
const SWIPE_LOCK_MS = 700;

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
    useAltRotate = false,
    onFlip,
    onTap,
  } = opts;

  interface PointerState {
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

  // Gesture tracking state
  let gestureType: "drag" | "pinch_rotate" | "alt_rotate" | "trackpad_rotate" | null = null;
  let gestureStartTime = 0;

  let trackpadRotateStartRot = 0;
  let trackpadRotateAnchorLocal: Vec2 | undefined;
  let trackpadRotateAnchorScreen: Vec2 | undefined;

  let tapCandidate: { pointerId: number; startPos: Vec2; startTime: number } | undefined;

  let swipeAccumX = 0;
  let swipeAccumY = 0;
  let swipeSegmentTimer: ReturnType<typeof setTimeout> | undefined;
  let swipeLocked = false;
  let swipeLockTimer: ReturnType<typeof setTimeout> | undefined;

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
    pointers.set(e.pointerId, { pos });

    const hit = getPaperAt(pos);
    if (hit) {
      setActivePaper(hit);
      bringPaperToTop(hit);
    }

    const paper = getActivePaper();

    tapCandidate =
      onTap && !hit && pointers.size === 1
        ? { pointerId: e.pointerId, startPos: pos, startTime: performance.now() }
        : undefined;

    if (pointers.size === 2) {
      tapCandidate = undefined;
      const pts = Array.from(pointers.values()).map((s) => s.pos);
      const mid = mul2(add2(pts[0], pts[1]), 0.5);
      pinchLastMid = mid;
      pinchLastAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      dragOffset = undefined;
      gestureType = "pinch_rotate";
      gestureStartTime = performance.now();
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
      gestureType = "alt_rotate";
      gestureStartTime = performance.now();
      return;
    }

    dragOffset = sub2(pos, paper.pos);
    gestureType = "drag";
    gestureStartTime = performance.now();
  };

  const onPointerMove = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    const pos = getPointerPos(e);
    state.pos = pos;

    if (tapCandidate && tapCandidate.pointerId === e.pointerId) {
      const moved = Math.hypot(
        pos.x - tapCandidate.startPos.x,
        pos.y - tapCandidate.startPos.y,
      );
      if (moved > TAP_MAX_MOVE_PX) tapCandidate = undefined;
    }

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

  const trackGestureEnd = () => {
    if (gestureType && gestureStartTime > 0) {
      const duration = Math.round(performance.now() - gestureStartTime);
      trackEvent("gesture_used", {
        gesture_type: gestureType,
        duration_ms: duration,
      });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);

    if (tapCandidate && tapCandidate.pointerId === e.pointerId) {
      const duration = performance.now() - tapCandidate.startTime;
      if (duration <= TAP_MAX_DURATION_MS) onTap?.();
    }
    tapCandidate = undefined;

    trackGestureEnd();

    if (pointers.size < 2) {
      pinchLastMid = undefined;
    }

    if (rotatePointerId === e.pointerId) {
      rotatePointerId = undefined;
      rotateAnchorLocal = undefined;
      rotateAnchorScreen = undefined;
    }

    dragOffset = undefined;
    gestureType = null;
    gestureStartTime = 0;
  };

  const onPointerCancel = () => {
    pointers.clear();
    tapCandidate = undefined;
    dragOffset = undefined;
    pinchLastMid = undefined;
    rotatePointerId = undefined;
    rotateAnchorLocal = undefined;
    rotateAnchorScreen = undefined;
    gestureType = null;
    gestureStartTime = 0;
  };

  // Safari/Chrome on macOS emit these for a trackpad two-finger twist.
  // `rotation` is cumulative degrees since gesturestart; not in lib.dom.d.ts.
  interface MacGestureEvent extends Event {
    rotation: number;
  }

  const onGestureStart = (e: Event) => {
    e.preventDefault();
    if (getLockState() === InputLock.Locked) return;

    const paper = getActivePaper();
    trackpadRotateAnchorLocal = getPaperLocalCentroid(paper);
    trackpadRotateAnchorScreen = localToScreen(paper, trackpadRotateAnchorLocal);
    trackpadRotateStartRot = paper.rot;
    gestureType = "trackpad_rotate";
    gestureStartTime = performance.now();
  };

  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (getLockState() === InputLock.Locked) return;
    if (!trackpadRotateAnchorLocal || !trackpadRotateAnchorScreen) return;

    const ge = e as MacGestureEvent;
    const paper = getActivePaper();
    paper.rot = trackpadRotateStartRot + (ge.rotation * Math.PI) / 180;
    const anchorOffset = rotate2(
      mul2(trackpadRotateAnchorLocal, paper.scale),
      paper.rot,
    );
    paper.pos = sub2(trackpadRotateAnchorScreen, anchorOffset);
  };

  const onGestureEnd = (e: Event) => {
    e.preventDefault();

    trackGestureEnd();

    trackpadRotateAnchorLocal = undefined;
    trackpadRotateAnchorScreen = undefined;
    gestureType = null;
    gestureStartTime = 0;
  };

  // Two-finger trackpad swipe: reported as `wheel` events with deltaMode
  // DOM_DELTA_PIXEL (0). A physical mouse wheel reports DOM_DELTA_LINE (1),
  // so gating on deltaMode filters those out. Works identically in the
  // browser build and the Tauri webview since both are WebKit/Blink.
  const onWheel = (e: WheelEvent) => {
    if (!onFlip) return;
    if (e.deltaMode !== 0) return;

    e.preventDefault();

    const horizontalDominant = Math.abs(e.deltaX) > Math.abs(e.deltaY);

    // A gap this long means a new physical swipe, not the same one continuing.
    if (swipeSegmentTimer !== undefined) clearTimeout(swipeSegmentTimer);
    swipeSegmentTimer = setTimeout(() => {
      swipeAccumX = 0;
      swipeAccumY = 0;
    }, SWIPE_SEGMENT_QUIET_MS);

    if (swipeLocked || getLockState() === InputLock.Locked) return;

    if (horizontalDominant) {
      swipeAccumX += e.deltaX;
      swipeAccumY = 0;
    } else {
      swipeAccumY += e.deltaY;
      swipeAccumX = 0;
    }

    const accum = horizontalDominant ? swipeAccumX : swipeAccumY;
    if (Math.abs(accum) >= SWIPE_FLIP_THRESHOLD_PX) {
      const sign = accum > 0 ? 1 : -1;
      const direction: FlipDirection = horizontalDominant ? sign : (-sign as FlipDirection);
      const axis: FlipAxis = horizontalDominant ? "horizontal" : "vertical";
      swipeAccumX = 0;
      swipeAccumY = 0;
      swipeLocked = true;
      onFlip(direction, axis);
      trackEvent("gesture_used", { gesture_type: "swipe_flip", duration_ms: 0 });

      // Fixed cooldown, scheduled once and never renewed by later wheel
      // events — a momentum tail arriving in dense sub-100ms bursts must not
      // be able to keep pushing this out indefinitely.
      if (swipeLockTimer !== undefined) clearTimeout(swipeLockTimer);
      swipeLockTimer = setTimeout(() => {
        swipeLocked = false;
      }, SWIPE_LOCK_MS);
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("gesturestart", onGestureStart as EventListener);
  canvas.addEventListener("gesturechange", onGestureChange as EventListener);
  canvas.addEventListener("gestureend", onGestureEnd as EventListener);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("gesturestart", onGestureStart as EventListener);
    canvas.removeEventListener("gesturechange", onGestureChange as EventListener);
    canvas.removeEventListener("gestureend", onGestureEnd as EventListener);
    canvas.removeEventListener("wheel", onWheel);
    if (swipeSegmentTimer !== undefined) clearTimeout(swipeSegmentTimer);
    if (swipeLockTimer !== undefined) clearTimeout(swipeLockTimer);
  };
}
