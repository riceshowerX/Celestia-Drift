import { persistWarpDebounced, warp } from "./state";

const GAME_CODES = new Set([
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function bindInput(root: HTMLElement) {
  let lastX = 0;
  let lastY = 0;
  let hasLast = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    warp.keys.add(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
    if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      warp.boostHeld = true;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    warp.keys.delete(e.code);
    if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      if (
        !warp.keys.has("Space") &&
        !warp.keys.has("ShiftLeft") &&
        !warp.keys.has("ShiftRight")
      ) {
        warp.boostHeld = false;
      }
    }
  };

  const clearKeys = () => {
    warp.keys.clear();
    if (!warp.pointerOnHud) warp.boostHeld = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    warp.pointerInside = true;
    warp.touchLook = touch;

    if (warp.pointerOnHud || warp.qaKeys) {
      lastX = e.clientX;
      lastY = e.clientY;
      hasLast = true;
      return;
    }

    if (touch) {
      if (hasLast) {
        const dx = (e.clientX - lastX) / r.width;
        const dy = (e.clientY - lastY) / r.height;
        warp.lookX = clamp(warp.lookX + dx * 2.4, -1, 1);
        warp.lookY = clamp(warp.lookY + dy * 2.4, -1, 1);
      }
    } else {
      warp.lookX = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      warp.lookY = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    }
    lastX = e.clientX;
    lastY = e.clientY;
    hasLast = true;
  };

  const onPointerDown = (e: PointerEvent) => {
    warp.pointerInside = true;
    lastX = e.clientX;
    lastY = e.clientY;
    hasLast = true;
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      warp.touchLook = true;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    hasLast = false;
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      warp.pointerInside = false;
    }
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      warp.pointerInside = false;
      warp.touchLook = false;
    }
    hasLast = false;
  };

  const onWheel = (e: WheelEvent) => {
    // #22/#23: only hijack the gesture when it will actually change cruise —
    // at the min/max limit the wheel now scrolls the page normally instead of
    // being swallowed. Persistence matches the HUD sliders (debounced).
    const dir = e.deltaY > 0 ? -1 : 1;
    const next = clamp(warp.cruise + dir * 0.035, 0.05, 1);
    if (next === warp.cruise) return;
    e.preventDefault();
    warp.cruise = next;
    persistWarpDebounced();
  };

  const onBlur = () => clearKeys();
  const onVis = () => {
    if (document.hidden) clearKeys();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("pointerleave", onPointerLeave);
  root.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVis);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", onPointerUp);
    root.removeEventListener("pointerleave", onPointerLeave);
    root.removeEventListener("wheel", onWheel);
    // #24: `warp.keys` is a module-level Set shared across mounts — a remount
    // (HMR, route switch) must not inherit held keys from a torn-down one, or
    // boost/steer stay stuck on.
    clearKeys();
  };
}

export function pollGamepad() {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = pads[0];
  if (!pad) return;

  // Reusable scratch object (#10): this runs every frame — allocating a fresh
  // `{ x, y }` per call was pure GC churn against the render loop.
  const stick = dz(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK);
  if (!warp.qaKeys) {
    if (Math.abs(stick.x) > 0.001 || Math.abs(stick.y) > 0.001) {
      warp.lookX = clamp(warp.lookX * 0.4 + stick.x * 0.9, -1, 1);
      warp.lookY = clamp(warp.lookY * 0.4 + stick.y * 0.9, -1, 1);
      warp.pointerInside = true;
    }
  }

  const rt = pad.buttons[7]?.value ?? 0;
  const a = pad.buttons[0]?.pressed ?? false;
  warp.padBoost = rt > 0.25 || a;
}

// Scratch buffers for the per-frame deadzone math (#10).
const STICK = { x: 0, y: 0 };
function dz(
  x: number,
  y: number,
  out: { x: number; y: number },
  dead = 0.16,
): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dead) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scale = (m - dead) / (1 - dead) / m;
  out.x = x * scale;
  out.y = y * scale;
  return out;
}

// TODO(product) #25: pitch direction (input lookY → engine warp.pitch) may
// feel inverted vs. expectations (push up → look up?). Deliberately NOT
// changed without a product decision — flagging for confirmation.
