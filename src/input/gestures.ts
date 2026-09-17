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

// Each active gesture carries its own state as a discriminated union rather
// than a pile of independently-optional variables, so a variant's fields
// (e.g. rotate anchor) can never be half-set while another variant is active.
type Gesture =
  | { type: "idle" }
  | { type: "drag"; startTime: number; offset: Vec2 }
  | { type: "pinch_rotate"; startTime: number; lastMid: Vec2; lastAngle: number }
  | {
      type: "alt_rotate";
      startTime: number;
      pointerId: number;
      anchorLocal: Vec2;
      anchorScreen: Vec2;
      startAngle: number;
      startRot: number;
    }
  | {
      type: "trackpad_rotate";
      startTime: number;
      anchorLocal: Vec2;
      anchorScreen: Vec2;
      startRot: number;
    };

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

  let gesture: Gesture = { type: "idle" };

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

    // A tap can land on the paper (starts a drag/rotate gesture too, but a
    // sub-threshold release still counts as a tap) or on empty canvas.
    tapCandidate =
      onTap && pointers.size === 1
        ? { pointerId: e.pointerId, startPos: pos, startTime: performance.now() }
        : undefined;

    if (pointers.size === 2) {
      tapCandidate = undefined;
      const pts = Array.from(pointers.values()).map((s) => s.pos);
      const mid = mul2(add2(pts[0], pts[1]), 0.5);
      gesture = {
        type: "pinch_rotate",
        startTime: performance.now(),
        lastMid: mid,
        lastAngle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
      };
      return;
    }

    if (useAltRotate && e.altKey) {
      const anchorLocal = getPaperLocalCentroid(paper);
      const anchorScreen = localToScreen(paper, anchorLocal);
      gesture = {
        type: "alt_rotate",
        startTime: performance.now(),
        pointerId: e.pointerId,
        anchorLocal,
        anchorScreen,
        startAngle: Math.atan2(pos.y - anchorScreen.y, pos.x - anchorScreen.x),
        startRot: paper.rot,
      };
      return;
    }

    gesture = { type: "drag", startTime: performance.now(), offset: sub2(pos, paper.pos) };
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

    if (gesture.type === "pinch_rotate" && pointers.size === 2) {
      const pts = Array.from(pointers.values()).map((s) => s.pos);
      const mid = mul2(add2(pts[0], pts[1]), 0.5);
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

      let dAng = ang - gesture.lastAngle;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;

      const dMid = sub2(mid, gesture.lastMid);
      paper.pos = add2(paper.pos, dMid);
      paper.pos = add2(mid, rotate2(sub2(paper.pos, mid), dAng));
      paper.rot += dAng;

      gesture.lastMid = mid;
      gesture.lastAngle = ang;
      return;
    }

    if (gesture.type === "alt_rotate" && gesture.pointerId === e.pointerId) {
      const ang = Math.atan2(pos.y - gesture.anchorScreen.y, pos.x - gesture.anchorScreen.x);
      paper.rot = gesture.startRot + (ang - gesture.startAngle);
      const anchorOffset = rotate2(mul2(gesture.anchorLocal, paper.scale), paper.rot);
      paper.pos = sub2(gesture.anchorScreen, anchorOffset);
      return;
    }

    if (gesture.type === "drag") {
      paper.pos = sub2(pos, gesture.offset);
    }
  };

  const trackGestureEnd = () => {
    if (gesture.type !== "idle") {
      const duration = Math.round(performance.now() - gesture.startTime);
      trackEvent("gesture_used", {
        gesture_type: gesture.type,
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
    gesture = { type: "idle" };
  };

  const onPointerCancel = () => {
    pointers.clear();
    tapCandidate = undefined;
    gesture = { type: "idle" };
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
    const anchorLocal = getPaperLocalCentroid(paper);
    gesture = {
      type: "trackpad_rotate",
      startTime: performance.now(),
      anchorLocal,
      anchorScreen: localToScreen(paper, anchorLocal),
      startRot: paper.rot,
    };
  };

  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (getLockState() === InputLock.Locked) return;
    if (gesture.type !== "trackpad_rotate") return;

    const ge = e as MacGestureEvent;
    const paper = getActivePaper();
    paper.rot = gesture.startRot + (ge.rotation * Math.PI) / 180;
    const anchorOffset = rotate2(mul2(gesture.anchorLocal, paper.scale), paper.rot);
    paper.pos = sub2(gesture.anchorScreen, anchorOffset);
  };

  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    trackGestureEnd();
    gesture = { type: "idle" };
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
