import * as SliderPrimitive from "@radix-ui/react-slider";
import { ChevronDown, ChevronUp, Volume2, VolumeX, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { starCount, useWarpUI, warp } from "./state";

function HudSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-3">
      <span className="w-10 shrink-0 text-xs font-medium tracking-wide text-fg-muted">
        {label}
      </span>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          // #19: clamp into range instead of silently falling back to `min` —
          // an undefined entry used to snap the slider to its minimum.
          const next = v[0] ?? value;
          onChange(Math.min(max, Math.max(min, next)));
        }}
        aria-label={label}
        className="relative flex h-11 w-full touch-none items-center"
      >
        <SliderPrimitive.Track className="relative h-0.5 w-full grow rounded-full bg-fg/15">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-3 rounded-full bg-fg shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-bg)_70%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-accent/80" />
      </SliderPrimitive.Root>
      <span className="w-10 shrink-0 text-right font-sans text-xs tabular-nums text-fg-muted">
        {display}
      </span>
    </label>
  );
}

function VelocityReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let id = 0;
    // Last written values (#18): only touch the DOM when the readout actually
    // changed — idle scenes (menu, steady cruise) stop DOM writes entirely.
    let lastFactor = "";
    let lastBoostOn: boolean | null = null;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const factor = 1 + warp.cruise * 2.1 + warp.boostAmt * 6.4;
      const factorText = factor.toFixed(1);
      if (ref.current && factorText !== lastFactor) {
        lastFactor = factorText;
        ref.current.textContent = factorText;
      }
      const boostOn = warp.boostAmt > 0.35;
      if (badge.current && boostOn !== lastBoostOn) {
        lastBoostOn = boostOn;
        badge.current.dataset.on = boostOn ? "1" : "0";
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[0.65rem] font-medium tracking-[0.22em] text-fg-subtle">
        WARP
      </span>
      <span
        ref={ref}
        className="font-sans text-lg font-medium tabular-nums tracking-tight text-fg"
      >
        1.0
      </span>
      <span
        ref={badge}
        className="text-[0.65rem] font-medium tracking-[0.18em] text-glow opacity-0 data-[on='1']:opacity-100"
      >
        BOOST
      </span>
    </div>
  );
}

function BoostButton() {
  const fill = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let id = 0;
    // Dirty checks (#18): skip the DOM writes when the boost value hasn't
    // moved (or the button is hidden — see the single mobile/desktop instance
    // fix below, which also removes the always-mounted duplicate's rAF).
    let lastFill = -1;
    let lastPressed: boolean | null = null;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const fillAmt = warp.boostAmt;
      if (fill.current && fillAmt !== lastFill) {
        lastFill = fillAmt;
        fill.current.style.transform = `scaleX(${fillAmt})`;
      }
      // Visual "pressed" state tracks the USER's held intent — the same
      // disjunct the engine uses — not the decaying `boostAmt`. Following the
      // decay made the button keep its active style for ~0.3s after release
      // (and flicker if boost was re-engaged mid-decay); the fill bar below
      // still communicates the smooth ramp.
      const pressed =
        warp.boostHeld ||
        warp.padBoost ||
        warp.keys.has("Space") ||
        warp.keys.has("ShiftLeft") ||
        warp.keys.has("ShiftRight");
      if (btn.current && pressed !== lastPressed) {
        lastPressed = pressed;
        btn.current.setAttribute("aria-pressed", pressed ? "true" : "false");
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const hold = (down: boolean) => {
    warp.boostHeld = down || warp.keys.has("Space");
  };

  return (
    <button
      ref={btn}
      type="button"
      aria-label="跃迁加速"
      aria-pressed="false"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        hold(true);
      }}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      // Keyboard parity (#a11y): Space/Enter press-and-hold mirrors the
      // pointer hold. Enter is not bound globally, so `boostHeld` is what the
      // engine reads; the `|| keys.has("Space")` disjunct keeps a held Space
      // (tracked by the global key bindings) boosting even when this
      // button-specific handler unmounts or the keyup lands out of order.
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") hold(true);
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") hold(false);
      }}
      // Focus leaving while held (Tab away) must not latch the boost on.
      onBlur={() => hold(false)}
      className={cn(
        "relative isolate h-11 min-w-28 overflow-hidden rounded-xl px-5",
        "bg-fg text-bg font-medium tracking-wide",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent/80",
        "transition-[transform,background-color,color] duration-[var(--motion-quick)] ease-[var(--ease-smooth-out)]",
        "hover:bg-accent active:scale-[0.96]",
        "aria-pressed:bg-accent aria-pressed:text-accent-fg",
      )}
    >
      <span
        ref={fill}
        className="pointer-events-none absolute inset-0 origin-left bg-glow/25"
        style={{ transform: "scaleX(0)" }}
      />
      <span className="relative flex items-center justify-center gap-2">
        <Zap className="size-4" strokeWidth={1.75} />
        跃迁
      </span>
    </button>
  );
}

export function Hud() {
  const cruise = useWarpUI((s) => s.cruise);
  const density = useWarpUI((s) => s.density);
  const trail = useWarpUI((s) => s.trail);
  const muted = useWarpUI((s) => s.muted);
  const entered = useWarpUI((s) => s.entered);
  const hudOpen = useWarpUI((s) => s.hudOpen);
  const setCruise = useWarpUI((s) => s.setCruise);
  const setDensity = useWarpUI((s) => s.setDensity);
  const setTrail = useWarpUI((s) => s.setTrail);
  const setMuted = useWarpUI((s) => s.setMuted);
  const setHudOpen = useWarpUI((s) => s.setHudOpen);

  const markHud = (on: boolean) => {
    warp.pointerOnHud = on;
  };

  // #20: if the HUD unmounts (route switch, dev remount) while the pointer is
  // over it, `pointerOnHud` would stay true forever and mouse look would be
  // dead — the engine keeps ignoring pointer input that never leaves.
  useEffect(() => {
    return () => {
      warp.pointerOnHud = false;
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col justify-between",
        "px-4 pt-4 md:px-6 md:pt-5",
        "pb-[max(1rem,env(safe-area-inset-bottom))]",
        "transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
        entered ? "opacity-100" : "opacity-0",
      )}
    >
      <header className="pointer-events-none flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-sm font-semibold tracking-[0.34em] text-fg">
            STARWAKE
          </p>
          <p className="mt-1 text-xs text-fg-subtle">星迹</p>
        </div>
        <div className="flex items-center gap-3">
          <VelocityReadout />
          <button
            type="button"
            aria-label={muted ? "取消静音" : "静音"}
            onClick={() => setMuted(!muted)}
            onPointerEnter={() => markHud(true)}
            onPointerLeave={() => markHud(false)}
            className={cn(
              "pointer-events-auto flex size-11 items-center justify-center rounded-xl",
              "text-fg-muted hover:text-fg",
              "shadow-[var(--shadow-border)] bg-surface/70",
              "outline-none focus-visible:ring-2 focus-visible:ring-accent/80",
              "transition-[color,transform] duration-[var(--motion-quick)] ease-[var(--ease-smooth-out)]",
              "active:scale-[0.96]",
            )}
          >
            {muted ? (
              <VolumeX className="size-4" strokeWidth={1.75} />
            ) : (
              <Volume2 className="size-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </header>

      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        aria-hidden
      >
        <div className="relative size-8">
          <span className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-fg/30" />
          <span className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 bg-fg/30" />
          <span className="absolute left-1/2 top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/75" />
        </div>
      </div>

      <div className="flex justify-center">
        <div
          onPointerEnter={() => markHud(true)}
          onPointerLeave={() => markHud(false)}
          onPointerDown={() => markHud(true)}
          className={cn(
            "pointer-events-auto w-full max-w-3xl rounded-[28px] p-4",
            "bg-surface/75 shadow-[var(--shadow-border)]",
            "transition-[opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-3 md:mb-0 md:hidden">
            <p className="text-xs tracking-wide text-fg-muted">航向控制</p>
            <button
              type="button"
              aria-expanded={hudOpen}
              aria-label={hudOpen ? "收起控制" : "展开控制"}
              onClick={() => setHudOpen(!hudOpen)}
              className="flex size-11 items-center justify-center rounded-xl text-fg-muted hover:text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
            >
              {hudOpen ? (
                <ChevronDown className="size-4" strokeWidth={1.75} />
              ) : (
                <ChevronUp className="size-4" strokeWidth={1.75} />
              )}
            </button>
          </div>

          <div
            className={cn(
              "flex flex-col gap-3 md:flex-row md:items-center md:gap-5",
              // Collapsed on mobile: hide ONLY the sliders and keep the
              // (single) BoostButton in view, right-aligned (#16). The old
              // second <BoostButton /> in a bottom `md:hidden` div meant two
              // always-mounted rAF loops whenever the HUD was collapsed.
              !hudOpen && "items-end md:items-center",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-5",
                !hudOpen && "hidden md:flex",
              )}
            >
              <HudSlider
                label="速度"
                value={cruise}
                min={0.05}
                max={1}
                step={0.01}
                display={`${Math.round(cruise * 100)}`}
                onChange={setCruise}
              />
              <HudSlider
                label="密度"
                value={density}
                min={0}
                max={1}
                step={0.01}
                display={`${starCount()}`}
                onChange={setDensity}
              />
              <HudSlider
                label="拖影"
                value={trail}
                min={0.08}
                max={1}
                step={0.01}
                display={`${Math.round(trail * 100)}`}
                onChange={setTrail}
              />
            </div>
            <BoostButton />
          </div>

          <p className="mt-3 hidden text-[0.7rem] tracking-wide text-fg-subtle md:block">
            指针转向 · WASD 微调 · 滚轮调速 · 空格或按住跃迁
          </p>
          {/* One-time reduced-motion notice: static text, no state, no rAF —
              it tells the user WHY the scene opens near-still (default cruise
              starts at the minimum under prefers-reduced-motion). */}
          {warp.reducedMotion ? (
            <p className="mt-2 text-[0.7rem] tracking-wide text-fg-subtle">
              已检测到系统「减弱动态效果」偏好：默认以最低巡航速度进入，可手动调高。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
