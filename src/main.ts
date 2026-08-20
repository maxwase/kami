import "./style.css";
import "viewportsegments-polyfill";
import { clamp } from "./math/scalars";
import { dot2, norm2, perp2, rotate2, type Vec2 } from "./math/vec2";
import { computeHingePoint, type HingeInfo } from "./device/hinge";
import { createMotionTracker } from "./device/motion";
import {
  helpCopyForSupport,
  HingeState,
  PostureSupport,
  readDevicePostureType,
  resolveHingeState,
  resolvePostureSupport,
} from "./device/posture";
import { getScreenAngleDeg, resolveScreenLandscape } from "./device/screen";
import { createIdCounter } from "./paper/ids";
import {
  makePaper,
  resetPaper,
  snapshotPaper,
  restorePaper,
  type Paper,
  type PaperStyle,
  type PaperSnapshot,
} from "./paper/model";
import { buildFoldAnim, commitFold, FoldSide, type FoldAnim } from "./paper/fold";
import { buildFlipAnim, commitFlip, type FlipAnim } from "./paper/flip";
import { hitTestPaper } from "./paper/hitTest";
import { attachGestureHandlers, InputLock } from "./input/gestures";
import { drawTable } from "./render/background";
import { drawHingeCrosshair } from "./render/hinge";
import {
  drawActiveOutline,
  drawFlatPaperFaces,
  drawFoldingPaper,
  drawFlippingPaper,
} from "./render/paper";
import { loadTextures, type TextureSet } from "./render/textures";
import { options, updateOptions } from "./config/options";
import { Device, Platform, resolveRuntimeInfo } from "./device/runtime";
import {
  initAnalytics,
  trackEvent,
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "./analytics";

initAnalytics();

const { platform, device } = resolveRuntimeInfo();

const canvasEl = getRequiredElement("c", HTMLCanvasElement);
const ctx = getRequiredCanvas2dContext(canvasEl);
ctx.imageSmoothingEnabled = true;

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
const settingsPanelEl = getRequiredElement("settingsPanel", HTMLDivElement);
const infoPanelEl = getRequiredElement("infoPanel", HTMLDivElement);
const debugStatusEl = getRequiredElement("debugStatus", HTMLDivElement);
const analyticsConsentEl = getRequiredElement("analyticsConsent", HTMLDivElement);
const consentAcceptBtn = getRequiredElement("consentAccept", HTMLButtonElement);
const consentDeclineBtn = getRequiredElement("consentDecline", HTMLButtonElement);
const analyticsPreferencesBtn = getRequiredElement(
  "analyticsPreferences",
  HTMLButtonElement,
);
const buyCoffeeLink = getRequiredElement("buyCoffee", HTMLAnchorElement);
const repoLink = getRequiredElement("repoLink", HTMLAnchorElement);

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

// How was the app launched: installed TWA, installed PWA, or browser tab.
function getLaunchContext(): "twa" | "pwa" | "browser" {
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

buyCoffeeLink.addEventListener("click", () => {
  trackEvent("outbound_link", {
    link_type: "buy_me_a_coffee",
    link_url: buyCoffeeLink.href,
  });
});
repoLink.addEventListener("click", () => {
  trackEvent("outbound_link", {
    link_type: "github",
    link_url: repoLink.href,
  });
});

// Expose an untyped trackEvent globally for use in other modules (e.g.
// gestures.ts) that can't import the typed EventMap directly.
(
  window as Window & {
    trackEvent?: (name: string, params?: Record<string, unknown>) => void;
  }
).trackEvent = (name, params) =>
  (trackEvent as (name: string, params?: Record<string, unknown>) => void)(
    name,
    params,
  );

let dpr = 1;
let cssW = 0;
let cssH = 0;
let hingeInfo: HingeInfo = computeHingePoint(0, 0);
let lastPostureType: string | null = null;
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
  hingeInfo = computeHingePoint(cssW, cssH);
  updateFoldFallbackIcon();
}
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
if (platform === Platform.Web && device === Device.Phone) {
  window.addEventListener(
    "devicemotion",
    (event) => {
      motionActive = true;
      motion.handleEvent(event);
    },
    { passive: true },
  );
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
const motion = createMotionTracker();
let motionActive = false;
const postureSupport = resolvePostureSupport();
let manualFoldQueued = false;

const A4_ASPECT = 210 / 297;
const PAPER_SCREEN_FRACTION = 0.6;

const styles: Record<string, PaperStyle> = {
  white: { front: "#ffffff", back: "#f0f0f0", edge: "rgba(0,0,0,0.16)" },
};

let currentAspect = A4_ASPECT;

// A4 paper size that fits within a fraction of the screen
function computePaperSize(
  viewW: number,
  viewH: number,
  aspect: number,
): { w: number; h: number } {
  const maxW = viewW * PAPER_SCREEN_FRACTION;
  const maxH = viewH * PAPER_SCREEN_FRACTION;
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
// aspect ratio.
function isOpenFoldableScreen(): boolean {
  if (platform !== Platform.Web || device !== Device.Phone) return false;
  return cssH > 0 && cssW / cssH > 0.7;
}

// Orient the sheet horizontal (landscape) when the foldable is open, otherwise
// match the screen. Driven by dimensions, not rotation, so the result is the
// same whether the viewport itself reads portrait or landscape.
function orientedPaperSize(
  viewW: number,
  viewH: number,
  aspect: number,
): { w: number; h: number } {
  const base = computePaperSize(viewW, viewH, aspect);
  if (isOpenFoldableScreen()) {
    return { w: Math.max(base.w, base.h), h: Math.min(base.w, base.h) };
  }
  return orientPaperSize(base, viewW, viewH);
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
  | { phase: "animating"; anim: FoldAnim; hinge: Vec2; hingeDir: Vec2 };

type FlipRuntime = { phase: "idle" } | { phase: "animating"; anim: FlipAnim };

let foldRuntime: FoldRuntime = { phase: "idle" };
let flipRuntime: FlipRuntime = { phase: "idle" };
let deviceFolded = false;

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
  const size = orientedPaperSize(cssW, cssH, currentAspect);
  paper.baseW = size.w;
  paper.baseH = size.h;
  resetPaper(paper, factory);
  const center = getScreenCenterInViewport();
  paper.pos = { x: center.x, y: center.y };

  trackEvent("paper_reset", {
    previous_face_count: prevFaceCount,
    aspect_ratio: currentAspect.toFixed(3),
    fold_count_session: foldCount,
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
    fold_count_session: foldCount,
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
});

if (postureSupport === PostureSupport.Unavailable) {
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    e.preventDefault();
    manualFoldQueued = true;
  });
}

foldFallbackBtn.style.display = "inline-block";
foldFallbackBtn.onclick = () => {
  manualFoldQueued = true;
  trackEvent("fold_triggered", {
    trigger_method: "button",
    fold_count_session: foldCount,
  });
};

flipPaperBtn.onclick = () => {
  if (foldRuntime.phase === "animating" || flipRuntime.phase === "animating") return;
  const paper = getActivePaper();
  // Start flip animation
  flipRuntime = {
    phase: "animating",
    anim: buildFlipAnim(paper),
  };
};

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

toggleSettingsBtn.onclick = () => {
  settingsVisible = !settingsVisible;
  if (settingsVisible) {
    infoVisible = false;
  }
  syncSettingsVisibility();
  syncInfoVisibility();
  trackEvent("panel_toggled", {
    panel: "settings",
    visible: settingsVisible,
  });
};

toggleInfoBtn.onclick = () => {
  infoVisible = !infoVisible;
  if (infoVisible) {
    settingsVisible = false;
  }
  syncInfoVisibility();
  syncSettingsVisibility();
  trackEvent("panel_toggled", {
    panel: "info",
    visible: infoVisible,
  });
};

syncSettingsVisibility();
syncInfoVisibility();

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    manualFoldQueued = true;
    trackEvent("fold_triggered", {
      trigger_method: e.code === "Space" ? "keyboard_space" : "keyboard_enter",
      fold_count_session: foldCount,
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
  trackEvent("setting_changed", {
    setting: "stability_threshold",
    value: options.stableAccel,
  });
});
stableAccelInput.addEventListener("input", updateStableAccelFromUi);
invertFoldDirectionInput.addEventListener("change", () => {
  updateOptions({ invertFoldDirection: invertFoldDirectionInput.checked });
  trackEvent("setting_changed", {
    setting: "invert_fold_direction",
    value: invertFoldDirectionInput.checked,
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
  trackEvent("setting_changed", {
    setting: "hinge_x",
    value: Number(manualHingeX.value),
  });
});
manualHingeY.addEventListener("change", () => {
  trackEvent("setting_changed", {
    setting: "hinge_y",
    value: Number(manualHingeY.value),
  });
});
manualHingeFlip.addEventListener("change", () => {
  updateOptions({ manualHingeDirFlip: manualHingeFlip.checked });
  trackEvent("setting_changed", {
    setting: "hinge_flip",
    value: manualHingeFlip.checked,
  });
});
manualHingeX.disabled = platform === Platform.Tauri && device === Device.Laptop;
manualHingeY.disabled = platform === Platform.Tauri && device === Device.Laptop;
const allowAccelAdjustments = platform === Platform.Web && device === Device.Phone;
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
      side: "front",
      color: paperFrontColorInput.value,
    });
  });

  paperFrontColorDisplay.addEventListener("click", () => {
    paperFrontColorInput.showPicker?.();
    if (!paperFrontColorInput.showPicker) paperFrontColorInput.click();
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
      side: "back",
      color: paperBackColorInput.value,
    });
  });

  paperBackColorDisplay.addEventListener("click", () => {
    paperBackColorInput.showPicker?.();
    if (!paperBackColorInput.showPicker) paperBackColorInput.click();
  });
}

const showPaperBorderInput = document.getElementById(
  "showPaperBorder",
) as HTMLInputElement;
if (showPaperBorderInput) {
  showPaperBorderInput.addEventListener("change", () => {
    updateOptions({ showPaperBorder: showPaperBorderInput.checked });
    trackEvent("setting_changed", {
      setting: "show_paper_border",
      value: showPaperBorderInput.checked,
    });
  });
}

let last = performance.now();

function tick(now: number) {
  try {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;

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
    const foldedNow = hingeState !== HingeState.Flat || manualFoldQueued;
    const screenAngle = normalizeScreenAngle(getScreenAngleDeg());
    const accel = motion.getAccel();
    const accelMag = Math.hypot(accel.x, accel.y);
    const isStable = motionActive && accelMag <= options.stableAccel;
    if (postureType !== lastPostureType) {
      lastPostureType = postureType;
      trackEvent("posture_change", {
        posture_type: postureType,
        hinge_x: Math.round(activeHinge.x),
        hinge_y: Math.round(activeHinge.y),
        screen_angle: Number(screenAngle.toFixed(1)),
        stable: isStable,
        accel: accel,
      });
    }
    const foldSide = resolveFoldSide(
      activeHingeDir,
      isStable,
      screenAngle,
      options.invertFoldDirection,
    );

    if (manualFoldQueued && foldedNow) {
      manualFoldQueued = false;
    }

    if (foldRuntime.phase === "idle" && foldedNow && !deviceFolded) {
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
        };
      }
    }
    deviceFolded = foldedNow;
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
            fold_side: activeAnim.foldSide === FoldSide.Front ? "front" : "back",
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
            fold_count_session: foldCount,
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

    for (const p of papers) {
      if (activeFoldAnim && activeFoldAnim.paperId === p.id) {
        drawFoldingPaper(ctx, p, activeFoldAnim, textures.paper);
      } else if (activeFlipAnim && activeFlipAnim.paperId === p.id) {
        drawFlippingPaper(ctx, p, activeFlipAnim, textures.paper);
      } else {
        drawFlatPaperFaces(ctx, p, textures.paper);
      }

      const hasActiveAnim = activeFoldAnim || activeFlipAnim;
      if (p.id === activePaperId && !hasActiveAnim && options.showPaperBorder) {
        drawActiveOutline(ctx, p);
      }
    }

    const segs = hingeInfo.segments;
    const pt = hingeInfo.hingePoint;
    const landscape = resolveScreenLandscape(cssW, cssH);
    const debugLines = [
      `state:${hingeState} posture:${postureType}`,
      `vp:${cssW}x${cssH} ${landscape ? "land" : "port"} @${screenAngle}°`,
      `segs:${segs.length}`,
      ...segs.map(
        (s, i) =>
          ` [${i}] x${Math.round(s.left)} y${Math.round(s.top)} ${Math.round(
            s.width,
          )}x${Math.round(s.height)}`,
      ),
      `segDir:${hingeInfo.hingeDir.x},${hingeInfo.hingeDir.y} pt:${
        pt ? `${Math.round(pt.x)},${Math.round(pt.y)}` : "-"
      }`,
      `useDir:${activeHingeDir.x.toFixed(0)},${activeHingeDir.y.toFixed(0)}`,
    ];
    if (platform === Platform.Web && device === Device.Phone) {
      debugLines.push(`accel:${accelMag.toFixed(2)}`);
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
  textures = await loadTextures(ctx);

  // Track session start with device context
  trackEvent("session_start", {
    platform: platform === Platform.Tauri ? "tauri" : "web",
    device_type: device === Device.Laptop ? "laptop" : "phone",
    posture_support:
      postureSupport === PostureSupport.Available ? "available" : "unavailable",
    screen_width: cssW,
    screen_height: cssH,
    device_pixel_ratio: dpr,
  });

  requestAnimationFrame(tick);
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
