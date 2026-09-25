import "./style.css";
import "viewportsegments-polyfill";
import {
  FoldSource,
  FoldTrigger,
  getAnalyticsConsent,
  initAnalytics,
  Panel,
  PaperSide,
  setAnalyticsConsent,
  trackEvent,
} from "./analytics";
import { playFlapSound, playFoldSound } from "./audio/sfx";
import { options, updateOptions } from "./config/options";
import { computeHingePoint, type HingeInfo } from "./device/hinge";
import { openExternal } from "./device/links";
import { bindDeviceMotion, createMotionTracker } from "./device/motion";
import {
  HingeState,
  helpCopyForSupport,
  PostureSupport,
  readDevicePostureType,
  resolveHingeState,
  resolvePostureSupport,
} from "./device/posture";
import { Device, Platform, resolveRuntimeInfo } from "./device/runtime";
import { getScreenAngleDeg, resolveScreenLandscape } from "./device/screen";
import { attachGestureHandlers, InputLock } from "./input/gestures";
import { clamp } from "./math/scalars";
import { dot2, norm2, perp2, rotate2, type Vec2 } from "./math/vec2";
import {
  buildFlipAnim,
  commitFlip,
  type FlipAnim,
  type FlipAxis,
  type FlipDirection,
} from "./paper/flip";
import { buildFoldAnim, commitFold, type FoldAnim, FoldSide } from "./paper/fold";
import { hitTestPaper } from "./paper/hitTest";
import { createIdCounter } from "./paper/ids";
import {
  makePaper,
  type Paper,
  type PaperMaterial,
  type PaperSide as SheetSide,
  type PaperSnapshot,
  type PaperStyle,
  resetPaper,
  restorePaper,
  snapshotPaper,
} from "./paper/model";
import { drawTable } from "./render/background";
import { drawHingeCrosshair } from "./render/hinge";
import { createPaperRenderer, type PaperMotion } from "./render/backend";
import {
  type BannerName,
  bannerUrl,
  loadBanner,
  resolveDefaultBannerName,
} from "./render/banners";
import {
  type FrontImageSource,
  loadTextures,
  type TextureSet,
} from "./render/textures";

initAnalytics();

const { platform, device } = resolveRuntimeInfo();

if (platform === Platform.Web) {
  const { registerServiceWorker } = await import("./pwa");
  registerServiceWorker();
}

/** Native iOS shell: a few links and controls behave differently there. */
const isIosNative = platform === Platform.Capacitor;

// Seed the iOS hinge cache before `resolvePostureSupport()` runs below —
// support is computed once, so a late answer would latch it to Unavailable.
let readCapacitorHingeAngle: () => number | null = () => null;
let isFoldable = false;
if (isIosNative) {
  const { initCapacitorHinge, getCapacitorHingeAngle, isCapacitorHingeAvailable } =
    await import("./device/capacitor");
  await initCapacitorHinge();
  readCapacitorHingeAngle = getCapacitorHingeAngle;
  isFoldable = isCapacitorHingeAvailable();
}

const PRIVACY_POLICY_URL = "https://kami.maxwase.eu/privacy/";

/**
 * Phones report acceleration; desktops and laptops either do not have the
 * sensor or report noise, and the fold-direction heuristic reads better
 * without it there.
 */
const motionSupported =
  device === Device.Phone &&
  (platform === Platform.Web || platform === Platform.Capacitor);

const canvasEl = getRequiredElement("c", HTMLCanvasElement);
const ctx = getRequiredCanvas2dContext(canvasEl);
ctx.imageSmoothingEnabled = true;

/**
 * Papers render through WebGL on canvases layered above the table canvas,
 * falling back to drawing them into the table canvas with Canvas2D. The table
 * and hinge crosshair always stay on the Canvas2D canvas underneath.
 */
const paperRenderer = createPaperRenderer({
  ctx,
  glCanvas: getRequiredElement("glc", HTMLCanvasElement),
  overlayCanvas: getRequiredElement("paperOverlay", HTMLCanvasElement),
  textures: () => textures,
});

const foldHelpEl = getRequiredElement("foldHelp", HTMLDivElement);
const gestureHelpEl = getRequiredElement("gestureHelp", HTMLDivElement);
const resetActiveBtn = getRequiredElement("resetActive", HTMLButtonElement);
const undoBtn = getRequiredElement("undo", HTMLButtonElement);
const foldFallbackBtn = getRequiredElement("foldFallback", HTMLButtonElement);
const foldFallbackIcon = foldFallbackBtn.querySelector(
  "span.material-symbols-outlined",
) as HTMLSpanElement | null;
const flipPaperBtn = getRequiredElement("flipPaper", HTMLButtonElement);
const stableAccelInput = getRequiredElement("stableAccel", HTMLInputElement);
const stableAccelValue = getRequiredElement("stableAccelValue", HTMLSpanElement);
const stableAccelRow = stableAccelInput.closest(".input-row");
const sfxVolumeInput = getRequiredElement("sfxVolume", HTMLInputElement);
const sfxVolumeValue = getRequiredElement("sfxVolumeValue", HTMLSpanElement);
const invertFoldDirectionInput = getRequiredElement(
  "invertFoldDirection",
  HTMLInputElement,
);
const manualHingeX = getRequiredElement("manualHingeX", HTMLInputElement);
const manualHingeY = getRequiredElement("manualHingeY", HTMLInputElement);
const hingeXValueEl = getRequiredElement("hingeXValue", HTMLSpanElement);
const hingeYValueEl = getRequiredElement("hingeYValue", HTMLSpanElement);
const manualHingeFlip = getRequiredElement("manualHingeFlip", HTMLInputElement);
const manualHingeFlipRow = manualHingeFlip.closest(".input-row");
const resetHingeBtn = getRequiredElement("resetHinge", HTMLButtonElement);
const toggleSettingsBtn = getRequiredElement("toggleSettings", HTMLButtonElement);
const toggleInfoBtn = getRequiredElement("toggleInfo", HTMLButtonElement);
const closeSettingsBtn = getRequiredElement("closeSettings", HTMLButtonElement);
const closeInfoBtn = getRequiredElement("closeInfo", HTMLButtonElement);
const settingsPanelEl = getRequiredElement("settingsPanel", HTMLDivElement);
const infoPanelEl = getRequiredElement("infoPanel", HTMLDivElement);
const debugStatusEl = getRequiredElement("debugStatus", HTMLDivElement);
const debugCopyBtn = getRequiredElement("debugCopy", HTMLButtonElement);
debugCopyBtn.addEventListener("click", () => {
  void navigator.clipboard.writeText(debugStatusEl.textContent ?? "");
});
const analyticsConsentEl = getRequiredElement("analyticsConsent", HTMLDivElement);
const consentAcceptBtn = getRequiredElement("consentAccept", HTMLButtonElement);
const consentDeclineBtn = getRequiredElement("consentDecline", HTMLButtonElement);
const analyticsPreferencesBtn = getRequiredElement(
  "analyticsPreferences",
  HTMLButtonElement,
);
const buyCoffeeLink = getRequiredElement("buyCoffee", HTMLAnchorElement);
const repoLink = getRequiredElement("repoLink", HTMLAnchorElement);
const frontImageInput = getRequiredElement("frontImageInput", HTMLInputElement);
const backImageInput = getRequiredElement("backImageInput", HTMLInputElement);

// --- Analytics consent gate (opt-in; identical across web/TWA/iOS/macOS) ---
function showAnalyticsConsent(): void {
  analyticsConsentEl.style.display = "flex";
}
function hideAnalyticsConsent(): void {
  analyticsConsentEl.style.display = "none";
}
if (getAnalyticsConsent() === "unset") {
  showAnalyticsConsent();
}
consentAcceptBtn.onclick = () => {
  setAnalyticsConsent(true);
  hideAnalyticsConsent();
  trackEvent("analytics_consent_changed", { granted: true });
};
consentDeclineBtn.onclick = () => {
  setAnalyticsConsent(false);
  hideAnalyticsConsent();
};
analyticsPreferencesBtn.onclick = () => {
  showAnalyticsConsent();
};

// How was the app launched: native iOS app, installed TWA, installed PWA, or
// browser tab. A Capacitor WebView reports neither a display-mode nor
// navigator.standalone, so it has to be checked before those.
function getLaunchContext(): "ios" | "twa" | "pwa" | "browser" {
  if (isIosNative) return "ios";
  if (document.referrer.startsWith("android-app://")) return "twa";
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  ) {
    return "pwa";
  }
  return "browser";
}
trackEvent("app_open", { launch_context: getLaunchContext() });

// Web browser visitors (not TWA/PWA/native) default to the Kami banner
// material, tappable to reach the Play Store — see bannerTappable below.
// twaInstalled flips true once bootstrap() checks getInstalledRelatedApps().
const isBrowserVisit = platform === Platform.Web && getLaunchContext() === "browser";
let twaInstalled = false;

// Which banner (Play Store / App Store / Mac) a browser visitor gets, and
// its lazily-loaded image once loadBanner() resolves. bannerImage stays
// null until the fetch completes (or fails), so bootstrap only switches the
// active paper's front material to "banner" once there's something to draw.
const activeBannerName: BannerName | null = isBrowserVisit
  ? resolveDefaultBannerName()
  : null;
let bannerImage: FrontImageSource | null = null;

// App Store guideline 3.1.1 forbids collecting money through a link out of an
// app distributed via the App Store (iOS or the Mac App Store build), so the
// tip jar only exists on web and TWA.
if (isIosNative || platform === Platform.Tauri) {
  buyCoffeeLink.remove();
} else {
  buyCoffeeLink.addEventListener("click", () => {
    trackEvent("outbound_link", {
      link_type: "buy_me_a_coffee",
      link_url: buyCoffeeLink.href,
    });
  });
}
repoLink.addEventListener("click", (event) => {
  trackEvent("outbound_link", {
    link_type: "github",
    link_url: repoLink.href,
  });
  if (openExternal(repoLink.href)) event.preventDefault();
});
// The native bundle has no /privacy/ page of its own (single-entry build), and
// the policy has to stay reachable for App Store review, so point at the
// hosted copy and open it in the in-app browser.
if (isIosNative) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href="/privacy/"]',
  )) {
    link.href = PRIVACY_POLICY_URL;
    link.addEventListener("click", (event) => {
      if (openExternal(PRIVACY_POLICY_URL)) event.preventDefault();
    });
  }
}

let dpr = 1;
let cssW = 0;
let cssH = 0;
let hingeInfo: HingeInfo = computeHingePoint(0, 0);
let foldCount = 0;

function resize() {
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    cssW = Math.floor(vv.width);
    cssH = Math.floor(vv.height);
  } else {
    cssW = Math.floor(window.innerWidth);
    cssH = Math.floor(window.innerHeight);
  }
  canvasEl.width = Math.floor(cssW * dpr);
  canvasEl.height = Math.floor(cssH * dpr);
  canvasEl.style.width = `${cssW}px`;
  canvasEl.style.height = `${cssH}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  paperRenderer.resize({
    cssW,
    cssH,
    dpr,
    bufferW: canvasEl.width,
    bufferH: canvasEl.height,
  });

  hingeInfo = computeHingePoint(cssW, cssH);
  updateFoldFallbackIcon();
}
/* Foldables (Duo cover display) leave a tall unused column on the right of
   the portrait canvas, while a bottom bar eats height the paper wants. On
   those devices the control footer becomes a vertical rail in that column.
   `isFoldable` is the test: only hardware with a real hinge reports through
   the Capacitor hinge plugin. */
const syncSideRail = () => {
  const portrait = window.innerHeight >= window.innerWidth;
  document.body.classList.toggle(
    "side-rail",
    portrait && isFoldable,
  );
};
syncSideRail();

window.addEventListener("resize", syncSideRail, { passive: true });
window.addEventListener("orientationchange", syncSideRail, { passive: true });

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("orientationchange", resize, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resize, { passive: true });
  window.visualViewport.addEventListener("scroll", resize, { passive: true });
}
if (window.screen?.orientation) {
  window.screen.orientation.addEventListener("change", resize, {
    passive: true,
  });
}
// Recompute segments when the foldable changes posture or the hinge gap moves.
interface ChangeTarget {
  addEventListener?: EventTarget["addEventListener"];
}
const viewportSegmentsTarget = (window as Window & { viewport?: ChangeTarget })
  .viewport;
if (typeof viewportSegmentsTarget?.addEventListener === "function") {
  viewportSegmentsTarget.addEventListener("change", resize, { passive: true });
}
const devicePostureTarget = (navigator as Navigator & { devicePosture?: ChangeTarget })
  .devicePosture;
if (typeof devicePostureTarget?.addEventListener === "function") {
  devicePostureTarget.addEventListener("change", resize, { passive: true });
}
if (motionSupported) {
  const onMotion = (event: DeviceMotionEvent) => {
    motionActive = true;
    motion.handleEvent(event);
  };
  if (platform === Platform.Capacitor) {
    // iOS only grants motion access from inside a user gesture, so the request
    // rides on the first touch of the canvas rather than on startup.
    const requestOnFirstTouch = () => {
      canvasEl.removeEventListener("pointerdown", requestOnFirstTouch);
      void bindDeviceMotion(onMotion);
    };
    canvasEl.addEventListener("pointerdown", requestOnFirstTouch, {
      passive: true,
    });
  } else {
    void bindDeviceMotion(onMotion);
  }
}
resize();

function updateFoldFallbackIcon(): void {
  if (!foldFallbackIcon) return;
  const isPortrait = !resolveScreenLandscape(cssW, cssH);
  foldFallbackIcon.textContent = isPortrait ? "devices_fold_2" : "devices_fold";
}

const nextFaceId = createIdCounter(1);
const nextPaperId = createIdCounter(1);
const factory = { nextFaceId, nextPaperId };

const undoStack: PaperSnapshot[] = [];
let textures!: TextureSet;
const pickedImages: Record<SheetSide, HTMLImageElement | null> = {
  front: null,
  back: null,
};
const motion = createMotionTracker();
let motionActive = false;
const postureSupport = resolvePostureSupport();
let manualFoldQueued = false;

const A4_ASPECT = 210 / 297;

const styles: Record<string, PaperStyle> = {
  white: { front: "#ffffff", back: "#f0f0f0", edge: "rgba(0,0,0,0.16)" },
};

let currentAspect = A4_ASPECT;

// Paper size that fits within the chosen fraction of the screen
function computePaperSize(
  viewW: number,
  viewH: number,
  aspect: number,
): { w: number; h: number } {
  const maxW = viewW * options.paperScale;
  const maxH = viewH * options.paperScale;
  if (maxW / maxH > aspect) {
    return { w: maxH * aspect, h: maxH };
  }
  return { w: maxW, h: maxW / aspect };
}

function orientPaperSize(
  size: { w: number; h: number },
  viewW: number,
  viewH: number,
): { w: number; h: number } {
  const isPortrait = viewH >= viewW;
  return isPortrait ? size : { w: size.h, h: size.w };
}

// Open inner screen = near-square/wide; closed cover screen = tall and narrow.
// Device posture can't tell them apart (both report "continuous"), so use the
// aspect ratio, compared short side to long side so rotation doesn't matter.
function isOpenFoldableScreen(): boolean {
  const onFoldablePhone =
    (platform === Platform.Web && device === Device.Phone) ||
    (platform === Platform.Capacitor && isFoldable);
  if (!onFoldablePhone || cssW <= 0 || cssH <= 0) return false;
  return Math.min(cssW, cssH) / Math.max(cssW, cssH) > 0.7;
}

// Orient the sheet horizontal (landscape) when the foldable is open, otherwise
// match the screen. Driven by dimensions, not rotation, so the result is the
// same whether the viewport itself reads portrait or landscape.
function orientedPaperSize(
  viewW: number,
  viewH: number,
  aspect: number,
): { w: number; h: number } {
  if (isOpenFoldableScreen()) {
    // Sized against the short side on both axes, so a reset gives the same
    // sheet in either rotation.
    const side = Math.min(viewW, viewH);
    const base = computePaperSize(side, side, aspect);
    // The iOS app keeps the sheet oriented with the screen; the web app lays
    // it horizontal on the open inner screen.
    if (platform === Platform.Capacitor) return orientPaperSize(base, viewW, viewH);
    return { w: Math.max(base.w, base.h), h: Math.min(base.w, base.h) };
  }
  return orientPaperSize(computePaperSize(viewW, viewH, aspect), viewW, viewH);
}

const initialCenter = getScreenCenterInViewport();
const initialSize = orientedPaperSize(cssW, cssH, currentAspect);
const papers: Paper[] = [
  makePaper(
    factory,
    styles.white,
    initialCenter.x,
    initialCenter.y,
    initialSize.w,
    initialSize.h,
  ),
];

let activePaperId = papers[0].id;

function getActivePaper(): Paper {
  const p = papers.find((pp) => pp.id === activePaperId);
  if (p) return p;
  activePaperId = papers[0].id;
  return papers[0];
}

function setActivePaper(p: Paper): void {
  activePaperId = p.id;
}

/**
 * True when the sheet is an unfolded banner showing its image (front) side, so
 * the Play Store ad is tappable. Derived from the sheet's own state — not the
 * session fold counter — so it correctly returns after a paper reset, an undo,
 * or a flip back to the front. Unfolded means a single face; a fold splits the
 * sheet into 2+ faces, a flip toggles the single face's up side.
 */
function bannerTappable(paper: Paper): boolean {
  return (
    paper.materials.front === "banner" &&
    paper.faces.length === 1 &&
    paper.faces[0].up === "front"
  );
}

function bringPaperToTop(p: Paper): void {
  const idx = papers.findIndex((x) => x.id === p.id);
  if (idx >= 0) {
    papers.splice(idx, 1);
    papers.push(p);
  }
}

function updateUndoBtn(isAnimating: boolean): void {
  undoBtn.disabled = undoStack.length === 0 || isAnimating;
}

type FoldRuntime =
  | { phase: "idle" }
  | {
      phase: "animating";
      anim: FoldAnim;
      hinge: Vec2;
      hingeDir: Vec2;
      foldSource: FoldSource;
    };

type FlipRuntime = { phase: "idle" } | { phase: "animating"; anim: FlipAnim };

let foldRuntime: FoldRuntime = { phase: "idle" };
let flipRuntime: FlipRuntime = { phase: "idle" };
// Null until the first frame seeds it with the hinge state at launch, so
// opening the app already folded (Duo outer screen) is not a fold edge.
let deviceFolded: boolean | null = null;

function normalizeScreenAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

function resolveFoldSide(
  hingeDir: Vec2,
  isStable: boolean,
  screenAngle: number,
  invert: boolean,
): FoldSide {
  const angleRad = (screenAngle * Math.PI) / 180;
  const hingeDirNatural = rotate2(hingeDir, angleRad);
  const foldLeftToRight = isStable ? 1 : -1;
  const directionSign = invert ? -1 : 1;
  const isVerticalHinge = Math.abs(hingeDirNatural.y) >= Math.abs(hingeDirNatural.x);
  const signedMove = foldLeftToRight * directionSign;
  let desiredMoveNatural: Vec2;
  if (isVerticalHinge) {
    desiredMoveNatural = signedMove > 0 ? { x: -1, y: 0 } : { x: 1, y: 0 };
  } else {
    desiredMoveNatural = signedMove > 0 ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }
  const desiredMove = rotate2(desiredMoveNatural, -angleRad);
  const normal = perp2(norm2(hingeDir));
  return dot2(desiredMove, normal) >= 0 ? FoldSide.Front : FoldSide.Back;
}

// Center of a physical screen in viewport coordinates.
// Where the hinge would be if the device were fully unfolded.
function getScreenCenterInViewport(): Vec2 {
  const vhError = getVhErrorPx();
  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2 - vhError,
  };
}

// Account for the bookmark and address bars on mobile browsers when
// visualViewport is unavailable.
function getVhErrorPx(): number {
  if (window.visualViewport) return 0;

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.height = "100vh";
  probe.style.width = "0";
  probe.style.pointerEvents = "none";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);

  const vhPx = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);

  return Math.max(0, vhPx - window.innerHeight);
}

resetActiveBtn.onclick = () => {
  if (foldRuntime.phase === "animating" || flipRuntime.phase === "animating") return;
  const paper = getActivePaper();
  const prevFaceCount = paper.faces.length;
  undoStack.push(snapshotPaper(paper));
  updateUndoBtn(false);
  const size = sizeForCurrentSelection();
  paper.baseW = size.w;
  paper.baseH = size.h;
  resetPaper(paper, factory);
  const center = getScreenCenterInViewport();
  paper.pos = { x: center.x, y: center.y };

  trackEvent("paper_reset", {
    previous_face_count: prevFaceCount,
    aspect_ratio: effectiveAspect().toFixed(3),
    fold_count: foldCount,
  });
};

undoBtn.onclick = () => {
  if (foldRuntime.phase === "animating" || flipRuntime.phase === "animating") return;
  const snap = undoStack.pop();
  if (!snap) return;
  restorePaper(getActivePaper(), snap);
  updateUndoBtn(false);

  trackEvent("undo_action", {
    remaining_undo_steps: undoStack.length,
    fold_count: foldCount,
  });
};

attachGestureHandlers({
  canvas: canvasEl,
  getPaperAt: (pos) => {
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i];
      if (hitTestPaper(p, pos)) return p;
    }
    return undefined;
  },
  getActivePaper,
  setActivePaper,
  bringPaperToTop,
  getLockState: () =>
    foldRuntime.phase === "animating" || flipRuntime.phase === "animating"
      ? InputLock.Locked
      : InputLock.Unlocked,
  useAltRotate: true, // Enable alt+drag rotation
  onFlip: (direction, axis) => startFlip(direction, axis),
  onTap: () => {
    manualFoldQueued = true;
    trackEvent("fold_triggered", {
      trigger_method: FoldTrigger.Tap,
      fold_source: FoldSource.Software,
      fold_count: foldCount,
    });
  },
});

// Play Store banner tap-to-open. A tap opens the store; dragging to reposition
// the sheet does not. This is detected on pointerup (which always fires) by how
// far the pointer travelled while pressed — NOT via the click event, because the
// browser suppresses click once the pointer moves during a press (the gesture
// handler captures the pointer and moves the sheet with it). Relying on click
// meant any sheet movement killed clickability. Now only folding removes it.
// Listeners are attached alongside attachGestureHandlers rather than inside it,
// since that already owns pointer capture on the same canvas; preventDefault is
// never called here so dragging is unaffected.
const TAP_SLOP_PX = 10;
let tapStart: { x: number; y: number } | null = null;
let tapMaxMove = 0;
canvasEl.addEventListener("pointerdown", (e) => {
  tapStart = { x: e.clientX, y: e.clientY };
  tapMaxMove = 0;
});
canvasEl.addEventListener("pointermove", (e) => {
  if (!tapStart) return;
  tapMaxMove = Math.max(
    tapMaxMove,
    Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y),
  );
});
const endTap = () => {
  tapStart = null;
  tapMaxMove = 0;
};
canvasEl.addEventListener("pointercancel", endTap);
canvasEl.addEventListener("pointerup", (e) => {
  const started = tapStart !== null;
  const moved = tapMaxMove;
  endTap();
  // Moving or rotating the sheet keeps it clickable; folding, or flipping to the
  // (plain) back, removes it. bannerTappable derives this from the sheet's own
  // state, so reset/undo/flip-back restore it correctly.
  if (
    !isBrowserVisit ||
    twaInstalled ||
    !activeBannerName ||
    foldRuntime.phase !== "idle" ||
    flipRuntime.phase !== "idle" ||
    !bannerTappable(getActivePaper())
  )
    return;
  if (!started || moved > TAP_SLOP_PX) return; // a drag, not a tap
  const rect = canvasEl.getBoundingClientRect();
  const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  for (let i = papers.length - 1; i >= 0; i--) {
    if (hitTestPaper(papers[i], pos)) {
      window.open(bannerUrl(activeBannerName), "_blank", "noopener");
      trackEvent("playstore_banner_tapped", { banner: activeBannerName });
      break;
    }
  }
});

if (postureSupport === PostureSupport.Unavailable) {
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    e.preventDefault();
    manualFoldQueued = true;
  });
}

foldFallbackBtn.onclick = () => {
  manualFoldQueued = true;
  trackEvent("fold_triggered", {
    trigger_method: FoldTrigger.Button,
    fold_source: FoldSource.Software,
    fold_count: foldCount,
  });
};

const startFlip = (direction: FlipDirection = 1, axis: FlipAxis = "horizontal") => {
  if (foldRuntime.phase === "animating" || flipRuntime.phase === "animating") return;
  const paper = getActivePaper();
  // Start flip animation
  flipRuntime = {
    phase: "animating",
    anim: buildFlipAnim(paper, direction, axis),
  };
  playFlapSound();
};

flipPaperBtn.onclick = () => startFlip();

const helpCopy = helpCopyForSupport(postureSupport);
foldHelpEl.innerHTML = helpCopy.controls;
gestureHelpEl.innerHTML = helpCopy.gesture;
let settingsVisible = false;
let infoVisible = false;

const syncSettingsVisibility = () => {
  settingsPanelEl.style.display = settingsVisible ? "flex" : "none";
  toggleSettingsBtn.setAttribute("aria-pressed", settingsVisible ? "true" : "false");
};

const syncInfoVisibility = () => {
  infoPanelEl.style.display = infoVisible ? "flex" : "none";
  toggleInfoBtn.setAttribute("aria-pressed", infoVisible ? "true" : "false");
};

const setSettingsVisible = (visible: boolean) => {
  settingsVisible = visible;
  if (settingsVisible) {
    infoVisible = false;
  }
  syncSettingsVisibility();
  syncInfoVisibility();
  trackEvent("panel_toggled", {
    panel: Panel.Settings,
    visible: settingsVisible,
  });
};

const setInfoVisible = (visible: boolean) => {
  infoVisible = visible;
  if (infoVisible) {
    settingsVisible = false;
  }
  syncInfoVisibility();
  syncSettingsVisibility();
  trackEvent("panel_toggled", {
    panel: Panel.Info,
    visible: infoVisible,
  });
};

toggleSettingsBtn.onclick = () => setSettingsVisible(!settingsVisible);
toggleInfoBtn.onclick = () => setInfoVisible(!infoVisible);
closeSettingsBtn.onclick = () => setSettingsVisible(false);
closeInfoBtn.onclick = () => setInfoVisible(false);

syncSettingsVisibility();
syncInfoVisibility();

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    manualFoldQueued = true;
    trackEvent("fold_triggered", {
      trigger_method:
        e.code === "Space" ? FoldTrigger.KeyboardSpace : FoldTrigger.KeyboardEnter,
      fold_source: FoldSource.Software,
      fold_count: foldCount,
    });
  } else if (e.code === "KeyF") {
    e.preventDefault();
    trackEvent("keyboard_shortcut", {
      key: "f",
      action: "flip",
    });
    flipPaperBtn.click();
  } else if (e.code === "KeyR") {
    e.preventDefault();
    trackEvent("keyboard_shortcut", {
      key: "r",
      action: "reset",
    });
    resetActiveBtn.click();
  }
});

function updateStableAccelFromUi() {
  const value = Number(stableAccelInput.value);
  const stableAccel = Number.isFinite(value) ? value : options.stableAccel;
  updateOptions({ stableAccel });
  stableAccelValue.textContent = `${options.stableAccel.toFixed(2)} m/s²`;
}

stableAccelInput.addEventListener("change", () => {
  updateStableAccelFromUi();
  trackEvent("stability_threshold_changed", { value: options.stableAccel });
});
stableAccelInput.addEventListener("input", updateStableAccelFromUi);

function updateSfxVolumeFromUi() {
  const value = Number(sfxVolumeInput.value);
  const sfxVolume = Number.isFinite(value) ? value : options.sfxVolume;
  updateOptions({ sfxVolume });
  sfxVolumeValue.textContent = `${Math.round(options.sfxVolume * 100)}%`;
}

sfxVolumeInput.addEventListener("change", () => {
  updateSfxVolumeFromUi();
  trackEvent("sfx_volume_changed", { value: options.sfxVolume });
});
sfxVolumeInput.addEventListener("input", updateSfxVolumeFromUi);
updateSfxVolumeFromUi();

invertFoldDirectionInput.addEventListener("change", () => {
  updateOptions({ invertFoldDirection: invertFoldDirectionInput.checked });
  trackEvent("invert_fold_direction_changed", {
    enabled: invertFoldDirectionInput.checked,
  });
});
const updateManualHingePos = () => {
  updateOptions({
    manualHingePos: {
      x: Number(manualHingeX.value) / 100,
      y: Number(manualHingeY.value) / 100,
    },
  });
};
manualHingeX.addEventListener("input", updateManualHingePos);
manualHingeY.addEventListener("input", updateManualHingePos);
manualHingeX.addEventListener("change", () => {
  trackEvent("hinge_manual_adjusted", { axis: "x", value: Number(manualHingeX.value) });
});
manualHingeY.addEventListener("change", () => {
  trackEvent("hinge_manual_adjusted", { axis: "y", value: Number(manualHingeY.value) });
});
manualHingeFlip.addEventListener("change", () => {
  updateOptions({ manualHingeDirFlip: manualHingeFlip.checked });
  trackEvent("hinge_flip_changed", { enabled: manualHingeFlip.checked });
});
manualHingeX.disabled = platform === Platform.Tauri && device === Device.Laptop;
manualHingeY.disabled = platform === Platform.Tauri && device === Device.Laptop;
const allowAccelAdjustments = motionSupported;
stableAccelInput.disabled = !allowAccelAdjustments;
if (stableAccelRow instanceof HTMLElement) {
  stableAccelRow.style.display = allowAccelAdjustments ? "flex" : "none";
}
if (manualHingeFlipRow instanceof HTMLElement) {
  manualHingeFlipRow.style.display = device === Device.Laptop ? "none" : "flex";
}
updateStableAccelFromUi();
updateManualHingePos();

// Reset Hinge Button
const handleHingeReset = (e: Event) => {
  e.preventDefault(); // Prevent ghost clicks or double firing
  manualHingeX.value = "50";
  manualHingeY.value = "50";
  manualHingeFlip.checked = false;
  manualHingeFlip.dispatchEvent(new Event("change"));
  updateManualHingePos();
  trackEvent("hinge_reset");
};

resetHingeBtn.addEventListener("click", handleHingeReset);
resetHingeBtn.addEventListener("touchend", handleHingeReset);

// Paper Options Logic
const paperSizeRadios = document.querySelectorAll('input[name="paperSize"]');
const customAspectInputs = document.getElementById(
  "customAspectInputs",
) as HTMLDivElement;
const customWidthInput = document.getElementById("customWidth") as HTMLInputElement;
const customHeightInput = document.getElementById("customHeight") as HTMLInputElement;

function getCustomAspect(): number {
  const w = parseFloat(customWidthInput.value) || 1;
  const h = parseFloat(customHeightInput.value) || 1;
  return w / h;
}

function updateAspectFromRadio(value: string): void {
  if (value === "a4") {
    currentAspect = A4_ASPECT;
    customAspectInputs.style.display = "none";
  } else if (value === "square") {
    currentAspect = 1.0;
    customAspectInputs.style.display = "none";
  } else if (value === "custom") {
    currentAspect = getCustomAspect();
    customAspectInputs.style.display = "block";
  }
}

paperSizeRadios.forEach((radio) => {
  radio.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    updateAspectFromRadio(target.value);
    trackEvent("paper_size_changed", {
      size_type: target.value,
      aspect_ratio: currentAspect.toFixed(3),
    });
    // Trigger reset to apply new size
    resetActiveBtn.click();
  });
});

// Update aspect ratio when custom inputs change
customWidthInput.addEventListener("change", () => {
  const selectedRadio = document.querySelector(
    'input[name="paperSize"]:checked',
  ) as HTMLInputElement;
  if (selectedRadio?.value === "custom") {
    trackEvent("paper_size_changed", {
      size_type: "custom",
      aspect_ratio: getCustomAspect().toFixed(3),
      custom_width: parseFloat(customWidthInput.value),
      custom_height: parseFloat(customHeightInput.value),
    });
  }
});
customWidthInput.addEventListener("input", () => {
  const selectedRadio = document.querySelector(
    'input[name="paperSize"]:checked',
  ) as HTMLInputElement;
  if (selectedRadio?.value === "custom") {
    currentAspect = getCustomAspect();
    resetActiveBtn.click();
  }
});

customHeightInput.addEventListener("change", () => {
  const selectedRadio = document.querySelector(
    'input[name="paperSize"]:checked',
  ) as HTMLInputElement;
  if (selectedRadio?.value === "custom") {
    trackEvent("paper_size_changed", {
      size_type: "custom",
      aspect_ratio: getCustomAspect().toFixed(3),
      custom_width: parseFloat(customWidthInput.value),
      custom_height: parseFloat(customHeightInput.value),
    });
  }
});
customHeightInput.addEventListener("input", () => {
  const selectedRadio = document.querySelector(
    'input[name="paperSize"]:checked',
  ) as HTMLInputElement;
  if (selectedRadio?.value === "custom") {
    currentAspect = getCustomAspect();
    resetActiveBtn.click();
  }
});

const materialRadios: Record<SheetSide, NodeListOf<HTMLInputElement>> = {
  front: document.querySelectorAll('input[name="frontMaterial"]'),
  back: document.querySelectorAll('input[name="backMaterial"]'),
};
const textureRadios: Record<SheetSide, NodeListOf<HTMLInputElement>> = {
  front: document.querySelectorAll('input[name="frontTexture"]'),
  back: document.querySelectorAll('input[name="backTexture"]'),
};
const paperSizeSelector = getRequiredElement("paperSizeSelector", HTMLDivElement);
const sideControls = {
  front: {
    color: getRequiredElement("frontColorRow", HTMLDivElement),
    texture: getRequiredElement("frontTextureRow", HTMLDivElement),
    pick: getRequiredElement("frontPickRow", HTMLDivElement),
    button: getRequiredElement("frontPickButton", HTMLButtonElement),
    name: getRequiredElement("frontPickName", HTMLSpanElement),
    input: frontImageInput,
  },
  back: {
    color: getRequiredElement("backColorRow", HTMLDivElement),
    texture: getRequiredElement("backTextureRow", HTMLDivElement),
    pick: getRequiredElement("backPickRow", HTMLDivElement),
    button: getRequiredElement("backPickButton", HTMLButtonElement),
    name: getRequiredElement("backPickName", HTMLSpanElement),
    input: backImageInput,
  },
};

function effectiveAspect(): number {
  const image = selectedSizeImage();
  return image ? image.width / image.height : currentAspect;
}

function selectedSizeImage(): HTMLImageElement | null {
  const paper = getActivePaper();
  const front = paper.materials.front === "custom" ? pickedImages.front : null;
  const back = paper.materials.back === "custom" ? pickedImages.back : null;
  return front ?? back;
}

function sizeForCurrentSelection(): { w: number; h: number } {
  const image = selectedSizeImage();
  return image
    ? computePaperSize(cssW, cssH, image.width / image.height)
    : orientedPaperSize(cssW, cssH, currentAspect);
}

function resizePaperIfNeeded(): void {
  const paper = getActivePaper();
  const size = sizeForCurrentSelection();
  if (Math.abs(paper.baseW - size.w) > 0.01 || Math.abs(paper.baseH - size.h) > 0.01) {
    resetActiveBtn.click();
  }
}

const paperScaleInput = getRequiredElement("paperScale", HTMLInputElement);
const paperScaleValue = getRequiredElement("paperScaleValue", HTMLSpanElement);

paperScaleInput.addEventListener("input", () => {
  const value = Number(paperScaleInput.value);
  if (!Number.isFinite(value)) return;
  updateOptions({ paperScale: value });
  paperScaleValue.textContent = `${Math.round(value * 100)}%`;
  resizePaperIfNeeded();
});
paperScaleInput.addEventListener("change", () => {
  trackEvent("paper_scale_changed", { value: options.paperScale });
});

function syncMaterialUi(): void {
  const materials = getActivePaper().materials;
  for (const side of ["front", "back"] as const) {
    const material = materials[side];
    materialRadios[side].forEach((radio) => {
      radio.checked = radio.value === (material === "banner" ? "paper" : material);
    });
    sideControls[side].color.hidden = material !== "color";
    sideControls[side].texture.hidden = material !== "paper" && material !== "banner";
    sideControls[side].pick.hidden = material !== "custom";
    textureRadios[side].forEach((radio) => {
      radio.checked = radio.value === material;
    });
  }
  const bothColor = materials.front === "color" && materials.back === "color";
  paperSizeSelector.classList.toggle("is-disabled", !bothColor);
  paperSizeSelector.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.disabled = !bothColor;
  });
}

for (const side of ["front", "back"] as const) {
  materialRadios[side].forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      if (radio.value === "custom" && !pickedImages[side]) {
        sideControls[side].input.click();
        syncMaterialUi();
        return;
      }
      getActivePaper().materials[side] =
        radio.value === "paper"
          ? [...textureRadios[side]].find((r) => r.checked)?.value === "banner"
            ? "banner"
            : "paper"
          : (radio.value as PaperMaterial);
      syncMaterialUi();
      resizePaperIfNeeded();
      trackEvent("paper_texture_changed", {
        side,
        texture: getActivePaper().materials[side],
      });
    });
  });

  const controls = sideControls[side];
  controls.button.addEventListener("click", () => {
    controls.input.value = "";
    controls.input.click();
  });
  controls.input.addEventListener("change", () => {
    const file = controls.input.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (pickedImages[side]) URL.revokeObjectURL(pickedImages[side].src);
      pickedImages[side] = img;
      controls.name.textContent = file.name;
      getActivePaper().materials[side] = "custom";
      syncMaterialUi();
      resizePaperIfNeeded();
      trackEvent("paper_custom_image_loaded", {
        side,
        width: img.width,
        height: img.height,
      });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  });
}

for (const side of ["front", "back"] as const) {
  textureRadios[side].forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      getActivePaper().materials[side] = radio.value === "banner" ? "banner" : "paper";
      syncMaterialUi();
      trackEvent("paper_texture_changed", {
        side,
        texture: radio.value === "banner" ? "banner" : "paper",
      });
    });
  });
}

function imageForMaterial(
  side: SheetSide,
  material: PaperMaterial,
): FrontImageSource | undefined {
  if (material === "banner") return bannerImage ?? undefined;
  if (material === "paper") return textures.paperImg;
  if (material === "custom") return pickedImages[side] ?? undefined;
  return undefined;
}

// RGB Color pickers for front and back sides
const paperFrontColorInput = document.getElementById(
  "paperFrontColor",
) as HTMLInputElement;
const paperFrontColorDisplay = document.getElementById(
  "paperFrontColorDisplay",
) as HTMLDivElement;
const paperBackColorInput = document.getElementById(
  "paperBackColor",
) as HTMLInputElement;
const paperBackColorDisplay = document.getElementById(
  "paperBackColorDisplay",
) as HTMLDivElement;

/** Compute edge color based on front color brightness. */
function computeEdgeColor(frontColor: string): string {
  const r = parseInt(frontColor.slice(1, 3), 16);
  const g = parseInt(frontColor.slice(3, 5), 16);
  const b = parseInt(frontColor.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.2)";
}

/** Update paper style from both color pickers. */
function updatePaperColors(): void {
  const paper = getActivePaper();
  const frontColor = paperFrontColorInput.value;
  const backColor = paperBackColorInput.value;

  paper.style = {
    front: frontColor,
    back: backColor,
    edge: computeEdgeColor(frontColor),
  };
}

if (paperFrontColorInput && paperFrontColorDisplay) {
  paperFrontColorDisplay.style.backgroundColor = paperFrontColorInput.value;

  paperFrontColorInput.addEventListener("input", () => {
    paperFrontColorDisplay.style.backgroundColor = paperFrontColorInput.value;
    updatePaperColors();
  });

  paperFrontColorInput.addEventListener("change", () => {
    trackEvent("color_changed", {
      side: PaperSide.Front,
      color: paperFrontColorInput.value,
    });
  });
}

if (paperBackColorInput && paperBackColorDisplay) {
  paperBackColorDisplay.style.backgroundColor = paperBackColorInput.value;

  paperBackColorInput.addEventListener("input", () => {
    paperBackColorDisplay.style.backgroundColor = paperBackColorInput.value;
    updatePaperColors();
  });

  paperBackColorInput.addEventListener("change", () => {
    trackEvent("color_changed", {
      side: PaperSide.Back,
      color: paperBackColorInput.value,
    });
  });
}

const showPaperBorderInput = document.getElementById(
  "showPaperBorder",
) as HTMLInputElement;
if (showPaperBorderInput) {
  showPaperBorderInput.addEventListener("change", () => {
    updateOptions({ showPaperBorder: showPaperBorderInput.checked });
    trackEvent("show_paper_border_changed", {
      enabled: showPaperBorderInput.checked,
    });
  });
}

/** One "key:value key:value" debug line, key order preserved from `row`. */
type DebugRow = Record<string, string | number>;
function fmtRow<T extends DebugRow>(row: T): string {
  return (Object.keys(row) as (keyof T & string)[])
    .map((k) => `${k}:${row[k]}`)
    .join(" ");
}

let last = performance.now();
let fps = 0;

function tick(now: number) {
  try {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;
    fps = dt > 0 ? fps + (1 / dt - fps) * 0.1 : fps;

    // Read segments fresh each frame: viewport.segments can update without
    // firing an event our listeners catch, which otherwise delays detection.
    hingeInfo = computeHingePoint(cssW, cssH);

    const postureType =
      postureSupport === PostureSupport.Available
        ? readDevicePostureType()
        : "fallback";
    const hingeState = resolveHingeState(postureType, hingeInfo.segments);
    // Detected physical crease (book mode) wins over the manual sliders.
    const detectedPoint =
      hingeState === HingeState.Creased ? hingeInfo.hingePoint : undefined;
    const isTauriLaptop = platform === Platform.Tauri && device === Device.Laptop;
    const manualHinge: Vec2 = {
      x: cssW * options.manualHingePos.x,
      y: cssH * options.manualHingePos.y,
    };

    let activeHinge: Vec2;
    let activeHingeDir: Vec2;
    if (isTauriLaptop) {
      activeHingeDir = { x: -1, y: 0 };
      activeHinge = { x: cssW / 2, y: cssH };
    } else if (detectedPoint) {
      activeHingeDir = hingeInfo.hingeDir;
      activeHinge = detectedPoint;
    } else {
      // No detected crease: derive the line from orientation. hingeInfo.hingeDir
      // is angle-aware (hingeDirForAngle), so this respects device rotation.
      // manualHingeDirFlip stays a user override.
      activeHingeDir = options.manualHingeDirFlip
        ? perp2(hingeInfo.hingeDir) // rotate 90° to flip line orientation
        : hingeInfo.hingeDir;
      activeHinge = manualHinge;
    }

    // Auto-fold on the fresh posture signal (folded-type = Creased or Closed),
    // not on segments alone: this device has a continuous screen that reports a
    // single segment, so a segment-only trigger lags or never fires.
    // Physical and manual triggers are edge-detected separately: on the Duo's
    // outer display the hinge reports Closed for as long as it is in use, so a
    // combined flag would stay high and swallow every tap/button fold.
    const physicallyFolded = hingeState !== HingeState.Flat;
    deviceFolded ??= physicallyFolded;
    const foldedNow = (physicallyFolded && !deviceFolded) || manualFoldQueued;
    const screenAngle = normalizeScreenAngle(getScreenAngleDeg());
    const accel = motion.getAccel();
    const accelMag = Math.hypot(accel.x, accel.y);
    const isStable = motionActive && accelMag <= options.stableAccel;
    const foldSide = resolveFoldSide(
      activeHingeDir,
      isStable,
      screenAngle,
      options.invertFoldDirection,
    );

    const foldSource: FoldSource = manualFoldQueued
      ? FoldSource.Software
      : FoldSource.Physical;
    if (manualFoldQueued && foldedNow) {
      manualFoldQueued = false;
    }

    if (foldRuntime.phase === "idle" && foldedNow) {
      const buildResult = buildFoldAnim(
        {
          paper: getActivePaper(),
          lineDirScreen: activeHingeDir,
          hingeScreen: activeHinge,
          foldSide,
        },
        { nextFaceId },
      );
      if (buildResult.kind === "built") {
        foldRuntime = {
          phase: "animating",
          anim: buildResult.anim,
          hinge: activeHinge,
          hingeDir: activeHingeDir,
          foldSource,
        };
        playFoldSound();
        // Button/keyboard paths already emit fold_triggered at the moment the
        // user acts (see foldFallbackBtn.onclick and the Space/Enter keydown
        // handler) - only the physical hinge path has no earlier trigger point.
        if (foldSource === FoldSource.Physical) {
          trackEvent("fold_triggered", {
            trigger_method: FoldTrigger.Hinge,
            fold_source: FoldSource.Physical,
            fold_count: foldCount,
          });
        }
      }
    }
    deviceFolded = physicallyFolded;
    const isAnimating =
      foldRuntime.phase === "animating" || flipRuntime.phase === "animating";
    updateUndoBtn(isAnimating);

    if (foldRuntime.phase === "animating") {
      const activeAnim = foldRuntime.anim;
      activeAnim.progress += dt / activeAnim.durationSeconds;
      if (activeAnim.progress >= 1) {
        activeAnim.progress = 1;
        const paper = papers.find((p) => p.id === activeAnim.paperId);
        if (paper) {
          undoStack.push(snapshotPaper(paper));
          updateUndoBtn(true);
          commitFold(paper, activeAnim, nextFaceId);
          foldCount += 1;
          trackEvent("fold_complete", {
            fold_count: foldCount,
            fold_side:
              activeAnim.foldSide === FoldSide.Front ? PaperSide.Front : PaperSide.Back,
            fold_source: foldRuntime.foldSource,
            hinge_x: Math.round(foldRuntime.hinge.x),
            hinge_y: Math.round(foldRuntime.hinge.y),
            duration_ms: Math.round(activeAnim.durationSeconds * 1000),
          });
        } else {
          // Invalid animation target; reset to a safe state.
          updateUndoBtn(false);
        }
        foldRuntime = { phase: "idle" };
      }
    }

    if (flipRuntime.phase === "animating") {
      const activeAnim = flipRuntime.anim;
      activeAnim.progress += dt / activeAnim.durationSeconds;
      if (activeAnim.progress >= 1) {
        activeAnim.progress = 1;
        const paper = papers.find((p) => p.id === activeAnim.paperId);
        if (paper) {
          undoStack.push(snapshotPaper(paper));
          updateUndoBtn(true);
          commitFlip(paper, activeAnim);
          trackEvent("flip_complete", {
            face_count: paper.faces.length,
            fold_count: foldCount,
            duration_ms: Math.round(activeAnim.durationSeconds * 1000),
          });
        } else {
          updateUndoBtn(false);
        }
        flipRuntime = { phase: "idle" };
      }
    }

    drawTable(ctx, cssW, cssH, textures.wood);
    const displayHinge =
      foldRuntime.phase === "animating" ? foldRuntime.hinge : activeHinge;
    const displayHingeDir =
      foldRuntime.phase === "animating" ? foldRuntime.hingeDir : activeHingeDir;
    hingeXValueEl.textContent = displayHinge.x.toFixed(0);
    hingeYValueEl.textContent = displayHinge.y.toFixed(0);
    drawHingeCrosshair(
      ctx,
      displayHinge,
      hingeInfo.segments,
      displayHingeDir,
      cssW,
      cssH,
    );

    const activeFoldAnim =
      foldRuntime.phase === "animating" ? foldRuntime.anim : undefined;
    const activeFlipAnim =
      flipRuntime.phase === "animating" ? flipRuntime.anim : undefined;

    const bannerClickable =
      isBrowserVisit &&
      !twaInstalled &&
      activeBannerName !== null &&
      foldRuntime.phase === "idle" &&
      flipRuntime.phase === "idle" &&
      bannerTappable(getActivePaper());
    canvasEl.style.cursor = bannerClickable ? "pointer" : "";

    const hasActiveAnim = activeFoldAnim || activeFlipAnim;
    paperRenderer.beginFrame();
    for (const p of papers) {
      const motion: PaperMotion =
        activeFoldAnim?.paperId === p.id
          ? { kind: "fold", anim: activeFoldAnim }
          : activeFlipAnim?.paperId === p.id
            ? { kind: "flip", anim: activeFlipAnim }
            : { kind: "flat" };
      paperRenderer.drawPaper({
        paper: p,
        motion,
        images: {
          front: imageForMaterial("front", p.materials.front),
          back: imageForMaterial("back", p.materials.back),
        },
        outline: p.id === activePaperId && !hasActiveAnim && options.showPaperBorder,
      });
    }
    paperRenderer.endFrame();

    const segs = hingeInfo.segments;
    const pt = hingeInfo.hingePoint;
    const landscape = resolveScreenLandscape(cssW, cssH);
    const faceCount = papers.reduce((n, p) => n + p.faces.length, 0);
    const debugActivePaper = getActivePaper();
    const debugLines = [
      fmtRow({ fps: fps.toFixed(0), engine: paperRenderer.engine() }),
      fmtRow({ platform, device }),
      fmtRow({ papers: papers.length, faces: faceCount }),
      fmtRow({
        paperPos: `${Math.round(debugActivePaper.pos.x)},${Math.round(debugActivePaper.pos.y)}`,
        paperSize: `${Math.round(debugActivePaper.baseW * debugActivePaper.scale)}x${Math.round(debugActivePaper.baseH * debugActivePaper.scale)}`,
        rot: `${((debugActivePaper.rot * 180) / Math.PI).toFixed(0)}°`,
      }),
      fmtRow({ state: hingeState, posture: postureType }),
      fmtRow({
        vp: `${cssW}x${cssH}`,
        orient: landscape ? "land" : "port",
        angle: `${screenAngle}°`,
      }),
      fmtRow({ segs: segs.length }),
      ...segs.map((s, i) =>
        fmtRow({
          seg: i,
          x: Math.round(s.left),
          y: Math.round(s.top),
          w: Math.round(s.width),
          h: Math.round(s.height),
        }),
      ),
      fmtRow({
        segDir: `${hingeInfo.hingeDir.x},${hingeInfo.hingeDir.y}`,
        pt: pt ? `${Math.round(pt.x)},${Math.round(pt.y)}` : "-",
      }),
      fmtRow({
        useDir: `${activeHingeDir.x.toFixed(0)},${activeHingeDir.y.toFixed(0)}`,
      }),
    ];
    if (motionSupported) {
      debugLines.push(fmtRow({ accel: accelMag.toFixed(2) }));
    }
    if (isIosNative) {
      const hingeDegrees = readCapacitorHingeAngle();
      debugLines.push(
        fmtRow({ hinge: hingeDegrees === null ? "-" : `${hingeDegrees.toFixed(0)}°` }),
      );
    }
    const debugText = debugLines.join("\n");
    if (debugStatusEl.textContent !== debugText) {
      debugStatusEl.textContent = debugText;
    }
  } finally {
    requestAnimationFrame(tick);
  }
}

void (async function bootstrap() {
  try {
    textures = await loadTextures(ctx);

    if (isBrowserVisit && activeBannerName) {
      // Progressive enhancement: most browsers lack this API, in which case
      // the banner default above just stands.
      const getInstalledRelatedApps = (
        navigator as Navigator & {
          getInstalledRelatedApps?: () => Promise<unknown[]>;
        }
      ).getInstalledRelatedApps;
      if (getInstalledRelatedApps) {
        try {
          const apps = await getInstalledRelatedApps.call(navigator);
          if (apps.length > 0) {
            twaInstalled = true;
          }
        } catch {
          // Treat a lookup failure as "not installed" — the banner stays.
        }
      }
      // Fetch the banner lazily so it can never delay first paint; only
      // switch the sheet to the "banner" material once an image actually
      // resolves. A failed/missing fetch (e.g. the App Store or Mac
      // banner placeholders — see render/banners.ts) leaves the sheet on
      // its plain paper default instead of a broken render.
      if (!twaInstalled) {
        const name = activeBannerName;
        void loadBanner(name).then((img) => {
          bannerImage = img;
          if (img && activeBannerName === name && !twaInstalled) {
            papers[0].materials.front = "banner";
            syncMaterialUi();
          }
        });
      }
    }
    syncMaterialUi();

    // Track session start with device context. `platform` is added automatically
    // by trackEvent() from resolveRuntimeInfo() - no need to pass it here.
    trackEvent("session_start", {
      device_type: device === Device.Laptop ? "laptop" : "phone",
      posture_support:
        postureSupport === PostureSupport.Available ? "available" : "unavailable",
      screen_width: cssW,
      screen_height: cssH,
      device_pixel_ratio: dpr,
    });
  } finally {
    // Never let a bootstrap failure (texture load, analytics, etc.) leave
    // the canvas permanently blank — the render loop must always start.
    requestAnimationFrame(tick);
  }
})();

function getRequiredElement<T extends HTMLElement>(
  id: string,
  ctor: new (...args: never[]) => T,
): T {
  const el = document.getElementById(id);
  if (!el || !(el instanceof ctor)) {
    throw new Error(`Required element #${id} not found`);
  }
  return el;
}

function getRequiredCanvas2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D context not available");
  return context;
}
