import "./style.css";
import { clamp } from "./math/scalars";
import { dot2, norm2, perp2, rotate2, type Vec2 } from "./math/vec2";
import { computeHingePoint, type HingeInfo } from "./device/hinge";
import { createMotionTracker } from "./device/motion";
import {
  FoldState,
  helpCopyForSupport,
  PostureSupport,
  readDevicePostureType,
  resolveFoldState,
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
import { hitTestPaper } from "./paper/hitTest";
import { attachGestureHandlers, InputLock } from "./input/gestures";
import { drawTable } from "./render/background";
import { drawHingeCrosshair } from "./render/hinge";
import {
  drawActiveOutline,
  drawFlatPaperFaces,
  drawFoldingPaper,
} from "./render/paper";
import { loadTextures, type TextureSet } from "./render/textures";
import { options, updateOptions } from "./config/options";
import { Device, Platform, resolveRuntimeInfo } from "./device/runtime";

const { platform, device } = resolveRuntimeInfo();

const canvasEl = getRequiredElement("c", HTMLCanvasElement);
const ctx = getRequiredCanvas2dContext(canvasEl);
ctx.imageSmoothingEnabled = true;

const foldHelpEl = getRequiredElement("foldHelp", HTMLDivElement);
const gestureHelpEl = getRequiredElement("gestureHelp", HTMLDivElement);
const resetActiveBtn = getRequiredElement("resetActive", HTMLButtonElement);
const undoBtn = getRequiredElement("undo", HTMLButtonElement);
const foldFallbackBtn = getRequiredElement("foldFallback", HTMLButtonElement);
const stableAccelInput = getRequiredElement("stableAccel", HTMLInputElement);
const stableAccelValue = getRequiredElement("stableAccelValue", HTMLSpanElement);
const stableAccelRow = stableAccelInput.closest(".input-row");
const invertFoldDirectionInput = getRequiredElement(
  "invertFoldDirection",
  HTMLInputElement,
);
const manualHingeX = getRequiredElement("manualHingeX", HTMLInputElement);
const manualHingeY = getRequiredElement("manualHingeY", HTMLInputElement);
const manualHingeFlip = getRequiredElement("manualHingeFlip", HTMLInputElement);
const manualHingeFlipRow = manualHingeFlip.closest(".input-row");
const resetHingeBtn = getRequiredElement("resetHinge", HTMLButtonElement);
const toggleSettingsBtn = getRequiredElement("toggleSettings", HTMLButtonElement);
const toggleStyleBtn = getRequiredElement("toggleStyle", HTMLButtonElement);
const toggleInfoBtn = getRequiredElement("toggleInfo", HTMLButtonElement);
const settingsPanelEl = getRequiredElement("settingsPanel", HTMLDivElement);
const stylePanelEl = getRequiredElement("stylePanel", HTMLDivElement);
const infoPanelEl = getRequiredElement("infoPanel", HTMLDivElement);
const hingeStatusEl = getRequiredElement("hingeStatus", HTMLDivElement);

let dpr = 1;
let cssW = 0;
let cssH = 0;
let hingeInfo: HingeInfo = computeHingePoint(0, 0);

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
}
window.addEventListener("resize", resize, { passive: true });
window.addEventListener("orientationchange", resize, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resize, { passive: true });
}
if (window.screen?.orientation) {
  window.screen.orientation.addEventListener("change", resize, {
    passive: true,
  });
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

let rotationDirection: "left" | "right" | null = null;
let rotationStartTime: number | null = null;
let rotationTargetAngle: number | null = null;
let rotationStartAngle: number | null = null;
let rotationAnimProgress = 1; // 0-1, 1 means complete

const startRotation = (dir: "left" | "right") => {
  const paper = getActivePaper();
  rotationDirection = dir;
  rotationStartTime = performance.now();

  // Set up animation
  const step = ((dir === "left" ? -1 : 1) * (5 * Math.PI)) / 180;
  rotationStartAngle = paper.rot;
  rotationTargetAngle = paper.rot + step;
  rotationAnimProgress = 0;
};

const stopRotation = () => {
  rotationDirection = null;
  rotationStartTime = null;
};

const setupRotation = (btnId: string, dir: "left" | "right") => {
  const btn = document.getElementById(btnId)!;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startRotation(dir);
  });
  btn.addEventListener("pointerup", stopRotation);
  btn.addEventListener("pointerleave", stopRotation);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
};

setupRotation("rotateLeft", "left");
setupRotation("rotateRight", "right");

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

const initialCenter = getScreenCenterInViewport();
const initialSize = orientPaperSize(
  computePaperSize(cssW, cssH, currentAspect),
  cssW,
  cssH,
);
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

let foldRuntime: FoldRuntime = { phase: "idle" };
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

/// Account for the bookmark and address bars on mobile browsers when
/// visualViewport is unavailable.
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
  if (foldRuntime.phase === "animating") return;
  const paper = getActivePaper();
  undoStack.push(snapshotPaper(paper));
  updateUndoBtn(false);
  const size = orientPaperSize(computePaperSize(cssW, cssH, currentAspect), cssW, cssH);
  paper.baseW = size.w;
  paper.baseH = size.h;
  resetPaper(paper, factory);
  const center = getScreenCenterInViewport();
  paper.pos = { x: center.x, y: center.y };
};

undoBtn.onclick = () => {
  if (foldRuntime.phase === "animating") return;
  const snap = undoStack.pop();
  if (!snap) return;
  restorePaper(getActivePaper(), snap);
  updateUndoBtn(false);
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
    foldRuntime.phase === "animating" ? InputLock.Locked : InputLock.Unlocked,
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
};

const helpCopy = helpCopyForSupport(postureSupport);
foldHelpEl.innerHTML = helpCopy.fold;
const gestureHelp =
  platform === Platform.Tauri && device === Device.Laptop
    ? "<b>Drag</b>: move.<br><b>Alt/Opt + drag</b>: rotate."
    : helpCopy.gesture.replace(". ", ".<br>");
gestureHelpEl.innerHTML = gestureHelp;
let settingsVisible = false;
let infoVisible = false;
let styleVisible = false;

const syncSettingsVisibility = () => {
  settingsPanelEl.style.display = settingsVisible ? "flex" : "none";
  toggleSettingsBtn.setAttribute("aria-pressed", settingsVisible ? "true" : "false");
};

const syncInfoVisibility = () => {
  infoPanelEl.style.display = infoVisible ? "flex" : "none";
  toggleInfoBtn.setAttribute("aria-pressed", infoVisible ? "true" : "false");
};

const syncStyleVisibility = () => {
  stylePanelEl.style.display = styleVisible ? "flex" : "none";
  toggleStyleBtn.setAttribute("aria-pressed", styleVisible ? "true" : "false");
};

toggleStyleBtn.onclick = () => {
  styleVisible = !styleVisible;
  if (styleVisible) {
    infoVisible = false;
    settingsVisible = false;
  }
  syncStyleVisibility();
  syncInfoVisibility();
  syncSettingsVisibility();
};

toggleSettingsBtn.onclick = () => {
  settingsVisible = !settingsVisible;
  if (settingsVisible) {
    infoVisible = false;
    styleVisible = false;
  }
  syncSettingsVisibility();
  syncInfoVisibility();
  syncStyleVisibility();
};

toggleInfoBtn.onclick = () => {
  infoVisible = !infoVisible;
  if (infoVisible) {
    settingsVisible = false;
    styleVisible = false;
  }
  syncInfoVisibility();
  syncSettingsVisibility();
  syncStyleVisibility();
};

syncSettingsVisibility();
syncInfoVisibility();
syncStyleVisibility();

// Keyboard shortcuts for folding (F, Enter, Space)
window.addEventListener("keydown", (e) => {
  if ((e.code === "KeyF" || e.code === "Enter" || e.code === "Space") && !e.repeat) {
    e.preventDefault();
    manualFoldQueued = true;
  }
});

function updateStableAccelFromUi() {
  const value = Number(stableAccelInput.value);
  const stableAccel = Number.isFinite(value) ? value : options.stableAccel;
  updateOptions({ stableAccel });
  stableAccelValue.textContent = `${options.stableAccel.toFixed(2)} m/s²`;
}

stableAccelInput.addEventListener("input", updateStableAccelFromUi);
invertFoldDirectionInput.addEventListener("change", () => {
  updateOptions({ invertFoldDirection: invertFoldDirectionInput.checked });
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
manualHingeFlip.addEventListener("change", () => {
  updateOptions({ manualHingeDirFlip: manualHingeFlip.checked });
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
  updateManualHingePos();
};

resetHingeBtn.addEventListener("click", handleHingeReset);
resetHingeBtn.addEventListener("touchend", handleHingeReset);

// Paper Options Logic
const paperSizeRadios = document.querySelectorAll('input[name="paperSize"]');
paperSizeRadios.forEach((radio) => {
  radio.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    currentAspect = target.value === "a4" ? A4_ASPECT : 1.0;
    // Trigger reset to apply new size
    resetActiveBtn.click();
  });
});

// RGB Color picker
const paperColorInput = document.getElementById("paperColor") as HTMLInputElement;
const paperColorDisplay = document.getElementById(
  "paperColorDisplay",
) as HTMLDivElement;

if (paperColorInput && paperColorDisplay) {
  // Initialize display with current color
  paperColorDisplay.style.backgroundColor = paperColorInput.value;

  // Update when color changes
  paperColorInput.addEventListener("input", () => {
    const color = paperColorInput.value;
    paperColorDisplay.style.backgroundColor = color;

    const paper = getActivePaper();

    // Simple darkening: reduce lightness by 10%
    const darkerColor = adjustColorBrightness(color, -0.1);

    // Determine edge color based on brightness
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const edgeColor = brightness > 128 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.2)";

    paper.style = {
      front: color,
      back: darkerColor,
      edge: edgeColor,
    };
  });

  // Click on display to open color picker
  paperColorDisplay.addEventListener("click", () => {
    // paperColorInput.click(); // This might not work in some browsers due to security
    paperColorInput.showPicker?.(); // Try showPicker API
    if (!paperColorInput.showPicker) paperColorInput.click(); // Fallback
  });
}

const showPaperBorderInput = document.getElementById(
  "showPaperBorder",
) as HTMLInputElement;
if (showPaperBorderInput) {
  showPaperBorderInput.addEventListener("change", () => {
    updateOptions({ showPaperBorder: showPaperBorderInput.checked });
  });
}

function adjustColorBrightness(hex: string, percent: number): string {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Adjust brightness
  const adjust = (val: number) => Math.max(0, Math.min(255, val + val * percent));
  const newR = Math.round(adjust(r));
  const newG = Math.round(adjust(g));
  const newB = Math.round(adjust(b));

  // Convert back to hex
  return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
}

let last = performance.now();

function tick(now: number) {
  try {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;

    // Animate rotation
    if (
      rotationAnimProgress < 1 &&
      rotationStartAngle !== null &&
      rotationTargetAngle !== null
    ) {
      rotationAnimProgress += dt * 6; // Animation speed
      if (rotationAnimProgress >= 1) {
        rotationAnimProgress = 1;
      }
      // Ease out cubic
      const t = rotationAnimProgress;
      const eased = 1 - Math.pow(1 - t, 3);
      const paper = getActivePaper();
      paper.rot =
        rotationStartAngle + (rotationTargetAngle - rotationStartAngle) * eased;
    }

    // Continuous Rotation
    if (rotationDirection && rotationStartTime) {
      const holdDuration = now - rotationStartTime;
      if (holdDuration > 200) {
        // If held for more than 200ms
        const activePaper = getActivePaper();
        const speed = Math.PI; // 180 degrees per second
        const sign = rotationDirection === "left" ? -1 : 1;
        activePaper.rot += sign * speed * dt;
        // Cancel step animation when continuous rotation starts
        rotationAnimProgress = 1;
      }
    }

    let hingeBaseDir = hingeInfo.hingeDir;
    if (platform === Platform.Tauri && device === Device.Laptop) {
      hingeBaseDir = { x: -1, y: 0 };
    } else if (
      platform === Platform.Web &&
      device === Device.Phone &&
      resolveScreenLandscape(cssW, cssH)
    ) {
      hingeBaseDir = { x: 0, y: 1 };
    }
    const activeHingeDir =
      platform === Platform.Tauri && device === Device.Laptop
        ? hingeBaseDir
        : platform === Platform.Web &&
          device === Device.Phone &&
          resolveScreenLandscape(cssW, cssH)
          ? hingeBaseDir
          : options.manualHingeDirFlip
            ? perp2(hingeBaseDir) // rotate 90° to flip line orientation
            : hingeBaseDir;
    const hingeY =
      platform === Platform.Tauri && device === Device.Laptop
        ? cssH
        : cssH * options.manualHingePos.y;
    const activeHinge: Vec2 = {
      x:
        platform === Platform.Tauri && device === Device.Laptop
          ? cssW / 2
          : cssW * options.manualHingePos.x,
      y: hingeY,
    };
    const postureType =
      postureSupport === PostureSupport.Available
        ? readDevicePostureType()
        : "fallback";
    const foldedNow =
      postureSupport === PostureSupport.Available
        ? resolveFoldState(postureType, hingeInfo.segments) === FoldState.Folded ||
        manualFoldQueued
        : manualFoldQueued;
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
    updateUndoBtn(foldRuntime.phase === "animating");

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
        } else {
          // Invalid animation target; reset to a safe state.
          updateUndoBtn(false);
        }
        foldRuntime = { phase: "idle" };
      }
    }

    drawTable(ctx, cssW, cssH, textures.wood);
    const displayHinge =
      foldRuntime.phase === "animating" ? foldRuntime.hinge : activeHinge;
    const displayHingeDir =
      foldRuntime.phase === "animating" ? foldRuntime.hingeDir : activeHingeDir;
    drawHingeCrosshair(
      ctx,
      displayHinge,
      hingeInfo.segments.segments,
      displayHingeDir,
      cssW,
      cssH,
    );

    const activeAnim = foldRuntime.phase === "animating" ? foldRuntime.anim : undefined;

    for (const p of papers) {
      if (activeAnim && activeAnim.paperId === p.id) {
        drawFoldingPaper(ctx, p, activeAnim, textures.paper);
      } else {
        drawFlatPaperFaces(ctx, p, textures.paper);
      }

      if (p.id === activePaperId && !activeAnim && options.showPaperBorder) {
        drawActiveOutline(ctx, p);
      }
    }

    const statusParts = [
      `posture=${postureType}`,
      `hinge=(${displayHinge.x.toFixed(0)},${displayHinge.y.toFixed(0)})`,
    ];
    if (platform === Platform.Web && device === Device.Phone) {
      statusParts.push(
        `accel=(${accel.x.toFixed(2)},${accel.y.toFixed(2)}) m/s²`,
        `accelMag=${accelMag.toFixed(2)} m/s²`,
      );
    }
    hingeStatusEl.textContent = statusParts.join(" | ");
  } finally {
    requestAnimationFrame(tick);
  }
}

void (async function bootstrap() {
  textures = await loadTextures(ctx);
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
