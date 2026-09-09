import { create } from "zustand";

const STORAGE_KEY = "starwake-v1";

export const MIN_STARS = 700;

// ── Device star cap (#31) ────────────────────────────────────────────────────
// Previously a module-load-time constant: rotating a phone or resizing the
// window never re-evaluated it, so a desktop-loaded tab kept the 11000 cap
// after shrinking (and vice versa). Now lazily recomputed and refreshed on
// resize. NOTE: engine buffers are still allocated at engine-creation size —
// a larger cap after resize only affects the starCount() target, which the
// engine clamps to its allocated buffer length.
function deviceMaxStars(): number {
  if (typeof window === "undefined") return 11000;
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720
    ? 5200
    : 11000;
}

let maxStars = deviceMaxStars();

/** Current device star cap (re-evaluated on window resize). */
export function maxStarCount(): number {
  return maxStars;
}

function refreshMaxStars(): void {
  maxStars = deviceMaxStars();
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", refreshMaxStars);
  // orientationchange fires without a preceding resize on some mobile
  // browsers — re-evaluate the device cap there too (phone rotation is the
  // main case where coarse-pointer + viewport-width flip together).
  window.addEventListener("orientationchange", refreshMaxStars);
}

/**
 * System motion preference (reduced-motion). Resolved once at module load:
 * `warp.reducedMotion` already tames roll/shake/FOV/trail/tunnel in the
 * engine — this const additionally shapes the DEFAULT cruise speed below.
 */
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type WarpSim = {
  cruise: number;
  density: number;
  trail: number;
  muted: boolean;
  entered: boolean;
  boostHeld: boolean;
  padBoost: boolean;
  pointerOnHud: boolean;
  pointerInside: boolean;
  lookX: number;
  lookY: number;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  boostAmt: number;
  trauma: number;
  reducedMotion: boolean;
  keys: Set<string>;
  qaSteer: number | null;
  qaKeys: Set<string> | null;
  touchLook: boolean;
};

function loadSaved(): Partial<
  Pick<WarpSim, "cruise" | "density" | "trail" | "muted">
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clamp01 = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(1, Math.max(0, v))
        : fallback;
    // clamp01 already validates range on load (#32): all stored values are
    // 0..1 NORMALIZED fractions, so a saved density adapts to whatever the
    // current device's [MIN_STARS, maxStarCount()] range is — the device cap
    // is applied at starCount() time, not storage time. Out-of-range or
    // non-numeric values fall back to the shipped defaults.
    return {
      cruise: clamp01(parsed.cruise, 0.42),
      density: clamp01(parsed.density, 0.52),
      trail: clamp01(parsed.trail, 0.7),
      muted: parsed.muted === true,
    };
  } catch {
    return {};
  }
}

const saved = loadSaved();

export const warp: WarpSim = {
  // Reduced-motion users start at the lowest cruise: the experience opens
  // near-still and any faster motion is an explicit user choice (slider or
  // W key), not something the app inflicts on load.
  cruise: saved.cruise ?? (prefersReducedMotion ? 0.05 : 0.42),
  density: saved.density ?? 0.52,
  trail: saved.trail ?? 0.7,
  muted: saved.muted ?? false,
  entered: false,
  boostHeld: false,
  padBoost: false,
  pointerOnHud: false,
  pointerInside: true,
  lookX: 0,
  lookY: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  speed: 80,
  boostAmt: 0,
  trauma: 0,
  reducedMotion: prefersReducedMotion,
  keys: new Set<string>(),
  qaSteer: null,
  qaKeys: null,
  touchLook: false,
};

// Dev-only singleton assertion (#33): `warp` is a mutable module singleton —
// if the module somehow evaluates twice (HMR edge case, dual bundler graph),
// two engine/input trees would mutate independent copies and QA probes would
// read the wrong one. Warn loudly in dev; production stays silent.
if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as typeof window & {
    __starwakeWarpSingleton__?: WarpSim;
  };
  if (w.__starwakeWarpSingleton__ && w.__starwakeWarpSingleton__ !== warp) {
    console.warn(
      "[starfield] multiple `warp` instances detected (module evaluated twice) — state may desync",
    );
  }
  w.__starwakeWarpSingleton__ = warp;
}

export function persistWarp() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cruise: warp.cruise,
        density: warp.density,
        trail: warp.trail,
        muted: warp.muted,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

// ── Debounced persistence ────────────────────────────────────────────────────
// HUD sliders fire onValueChange on every pointermove (up to 120Hz+). Writing
// localStorage synchronously per event (JSON.stringify + setItem) blocks the
// main thread against the 60fps WebGL loop — visible as dropped frames while
// dragging. Updates go through schedulePersistWarp (300ms trailing debounce);
// pagehide/visibilitychange flush any pending write so nothing is lost.
const PERSIST_DEBOUNCE_MS = 300;

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let flushListenersInstalled = false;

/** Write immediately if a debounced persist is still pending. */
function flushPendingPersist(): void {
  if (persistTimer === undefined) return;
  clearTimeout(persistTimer);
  persistTimer = undefined;
  persistWarp();
}

function installFlushListeners(): void {
  if (flushListenersInstalled || typeof window === "undefined") return;
  flushListenersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    // Flushing on hidden covers tab switches, app backgrounding (mobile) and
    // screen lock — the states where a pending write could otherwise be lost.
    if (document.visibilityState === "hidden") flushPendingPersist();
  });
  window.addEventListener("pagehide", flushPendingPersist);
}

function schedulePersistWarp(): void {
  if (typeof window === "undefined") return;
  installFlushListeners();
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistWarp();
  }, PERSIST_DEBOUNCE_MS);
}

/** Debounced persist for non-state-module writers (e.g. wheel input). */
export function persistWarpDebounced(): void {
  schedulePersistWarp();
}

export function starCount() {
  return Math.round(MIN_STARS + warp.density * (maxStars - MIN_STARS));
}

export type WarpUI = {
  cruise: number;
  density: number;
  trail: number;
  muted: boolean;
  entered: boolean;
  hudOpen: boolean;
  setCruise: (v: number) => void;
  setDensity: (v: number) => void;
  setTrail: (v: number) => void;
  setMuted: (v: boolean) => void;
  setEntered: (v: boolean) => void;
  setHudOpen: (v: boolean) => void;
};

export const useWarpUI = create<WarpUI>((set) => ({
  cruise: warp.cruise,
  density: warp.density,
  trail: warp.trail,
  muted: warp.muted,
  entered: false,
  hudOpen: true,
  setCruise: (v) => {
    const cruise = Math.min(1, Math.max(0.05, v));
    warp.cruise = cruise;
    // Debounced — fires per pointermove; a synchronous persist here stalled
    // the render loop (see "Debounced persistence" above).
    schedulePersistWarp();
    set({ cruise });
  },
  setDensity: (v) => {
    const density = Math.min(1, Math.max(0, v));
    warp.density = density;
    schedulePersistWarp();
    set({ density });
  },
  setTrail: (v) => {
    const trail = Math.min(1, Math.max(0.08, v));
    warp.trail = trail;
    schedulePersistWarp();
    set({ trail });
  },
  setMuted: (v) => {
    warp.muted = v;
    // Single click (not a per-frame drag stream) — persist immediately.
    // persistWarp serializes all keys straight from `warp`, so this write is
    // always consistent with any pending debounced slider update.
    persistWarp();
    set({ muted: v });
  },
  setEntered: (v) => {
    warp.entered = v;
    set({ entered: v });
  },
  setHudOpen: (v) => set({ hudOpen: v }),
}));

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer: (v: number) => void;
  setKeys: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
    __warpReady?: boolean;
  }
}

/**
 * QA controls probe (#21): writes `window.__controlsTest` for automated tests.
 * DEV-only — the production bundle must not expose (or pay for) the hook, and
 * a previous mount's probe is never left behind because it is simply never
 * installed outside dev.
 */
export function installControlsProbe() {
  if (!import.meta.env.DEV) return;
  window.__controlsTest = {
    getYaw: () => warp.yaw,
    getSpeed: () => warp.speed,
    setSteer: (v) => {
      warp.qaSteer = v;
    },
    setKeys: (codes) => {
      warp.qaKeys = codes.length ? new Set(codes) : null;
      if (!codes.length) warp.qaSteer = null;
    },
  };
}
