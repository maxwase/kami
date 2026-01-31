import type { Vec2 } from "../math/vec2";
import { getScreenAngleDeg } from "./screen";

export interface SegmentRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface HingeInfo {
  segments: SegmentRect[];
  hingeDir: Vec2;
}

interface WindowWithSegments extends Window {
  viewport?: { segments?: SegmentRect[] };
  getWindowSegments?: () => SegmentRect[] | null | undefined;
}

/** Resolve the hinge direction and viewport segments (when available). */
export function computeHingePoint(canvasCssW: number, canvasCssH: number): HingeInfo {
  const wAny = window as WindowWithSegments;

  try {
    const viewportSegmentsRaw = wAny.viewport?.segments;
    if (viewportSegmentsRaw !== undefined) {
      if (!Array.isArray(viewportSegmentsRaw)) {
        throw new Error("Viewport segments present but not an array");
      }
      const viewportSegments = readSegments(viewportSegmentsRaw);
      if (viewportSegments.length > 0) {
        return buildHingeInfo(viewportSegments, canvasCssW, canvasCssH);
      }
    }

    const visualViewport = window.visualViewport as
      | (VisualViewport & {
          segments?: SegmentRect[] | (() => SegmentRect[] | null | undefined);
        })
      | undefined;
    if (visualViewport) {
      if (typeof visualViewport.segments === "function") {
        const fromFunc = visualViewport.segments();
        if (!Array.isArray(fromFunc)) {
          throw new Error("visualViewport.segments() did not return an array");
        }
        const funcSegments = readSegments(fromFunc);
        return buildHingeInfo(funcSegments, canvasCssW, canvasCssH);
      }

      if (
        Array.isArray(visualViewport.segments) &&
        visualViewport.segments.length > 0
      ) {
        const valueSegments = readSegments(visualViewport.segments);
        if (valueSegments.length > 0) {
          return buildHingeInfo(valueSegments, canvasCssW, canvasCssH);
        }
      }
    }

    if (typeof wAny.getWindowSegments === "function") {
      const raw = wAny.getWindowSegments();
      if (!Array.isArray(raw)) {
        throw new Error("getWindowSegments() did not return an array");
      }
      const windowSegments = readSegments(raw);
      if (windowSegments.length > 0) {
        return buildHingeInfo(windowSegments, canvasCssW, canvasCssH);
      }
    }
  } catch (err) {
    // Fall through to fallback when segment APIs are missing or invalid.
    console.warn(err);
  }

  return {
    segments: [],
    hingeDir: fallbackHingeDir(getScreenAngleDeg(), canvasCssW, canvasCssH),
  };
}

function buildHingeInfo(
  segments: SegmentRect[],
  canvasCssW: number,
  canvasCssH: number,
): HingeInfo {
  return {
    segments,
    hingeDir: hingeDirFromSegments(segments, canvasCssW, canvasCssH),
  };
}

function readSegments(source: SegmentRect[]): SegmentRect[] {
  if (!Array.isArray(source)) {
    throw new Error("Missing viewport segments");
  }
  if (source.length === 0) {
    throw new Error("Viewport segments present but empty");
  }
  return source;
}

/**
 * Derive a hinge direction vector from provided screen segments.
 * Falls back to an orientation-derived direction when fewer than two segments exist.
 */
function hingeDirFromSegments(segs: SegmentRect[], w: number, h: number): Vec2 {
  const ratioDir = fallbackHingeDir(getScreenAngleDeg(), w, h);
  if (segs.length < 2) {
    return ratioDir;
  }

  const byLeft = [...segs].sort((a, b) => a.left - b.left);
  const byTop = [...segs].sort((a, b) => a.top - b.top);

  const aL = byLeft[0];
  const bL = byLeft[byLeft.length - 1];
  const gapX = bL.left - aL.right;

  const aT = byTop[0];
  const bT = byTop[byTop.length - 1];
  const gapY = bT.top - aT.bottom;

  if (gapX > 0 && gapX >= gapY) {
    return { x: 0, y: 1 };
  }
  if (gapY > 0 && gapY > gapX) {
    return { x: 1, y: 0 };
  }

  return ratioDir;
}

function hingeDirForAngle(angleDeg: number): Vec2 {
  const ang = ((Math.round(angleDeg) % 360) + 360) % 360;
  if (ang === 90 || ang === 270) return { x: 1, y: 0 };
  return { x: 0, y: 1 };
}

function fallbackHingeDir(
  angleDeg: number,
  canvasCssW: number,
  canvasCssH: number,
): Vec2 {
  if (canvasCssH >= canvasCssW) return { x: 1, y: 0 };
  return hingeDirForAngle(angleDeg);
}
