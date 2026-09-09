import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { createWarpAudio, type WarpAudio } from "./audio";
import { Hud } from "./Hud";
import { bindInput } from "./input";
import { installControlsProbe, useWarpUI, warp } from "./state";
import { StarfieldScene } from "./StarfieldScene";

// Dev-only QA hook (#21): guarded inside installControlsProbe itself.
if (import.meta.env.DEV) installControlsProbe();

/**
 * Cheap synchronous WebGL support probe: creating the real R3F canvas happens
 * at page load, but a device WITHOUT WebGL support would otherwise let the
 * user "enter" into a black screen with no explanation. Creating a throwaway
 * context here is the standard feature-detect (same call three.js makes).
 */
function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    return false;
  }
}

type IntroPhase = "idle" | "entering" | "error";

function Intro({ onEnter }: { onEnter: () => void }) {
  const [phase, setPhase] = useState<IntroPhase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up the transition timer so a fast unmount (HMR, route switch)
  // cannot call onEnter on a dead component.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const handleEnter = () => {
    if (phase !== "idle") return;
    if (!webglSupported()) {
      // Readable failure instead of a silent black screen.
      setPhase("error");
      return;
    }
    // One visible transition beat ("正在进入…", button disabled) so a double
    // tap cannot re-trigger entry and the state change reads as intentional.
    setPhase("entering");
    timer.current = setTimeout(onEnter, 220);
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-bg/60 px-6"
      // Anywhere-tap enters too, but through the same guard as the button
      // (WebGL check + transition) so the error path cannot be bypassed.
      onPointerDown={handleEnter}
    >
      <div className="max-w-md text-center">
        <p className="stagger-item font-display text-[0.7rem] font-medium tracking-[0.42em] text-fg-muted">
          星迹
        </p>
        <h1 className="stagger-item mt-3 font-display text-4xl font-semibold tracking-[0.28em] text-fg text-balance md:text-5xl">
          STARWAKE
        </h1>
        <p className="stagger-item mt-5 text-sm leading-relaxed text-fg-muted text-pretty">
          移动指针控制航向。调节速度与星体密度。按住跃迁进入超空间拖影。
        </p>
        <button
          type="button"
          disabled={phase !== "idle"}
          aria-label={phase === "entering" ? "正在进入星域" : "进入星域"}
          onPointerDown={(e) => {
            e.stopPropagation();
            handleEnter();
          }}
          // Keyboard parity: the button was pointer-only — Enter/Space on a
          // focused button fire click, not pointerdown, so keyboard users
          // could never enter. enter() is idempotent (warp.entered guard).
          onClick={(e) => {
            e.stopPropagation();
            handleEnter();
          }}
          className={cn(
            "stagger-item mt-8 inline-flex h-11 items-center justify-center rounded-xl px-8",
            "bg-fg text-bg text-sm font-medium tracking-[0.18em]",
            "outline-none focus-visible:ring-2 focus-visible:ring-accent/80",
            "transition-[transform,background-color] duration-[var(--motion-quick)] ease-[var(--ease-smooth-out)]",
            "hover:bg-accent active:scale-[0.96]",
            "disabled:cursor-default disabled:opacity-60",
          )}
        >
          {phase === "entering" ? "正在进入…" : "进入星域"}
        </button>
        {phase === "error" ? (
          <p
            role="alert"
            className="stagger-item mt-4 text-sm text-red-400"
          >
            当前浏览器不支持 WebGL，无法进入星域
          </p>
        ) : null}
        <p className="stagger-item mt-6 text-[0.7rem] tracking-wide text-fg-subtle">
          触控拖动转向 · 按住跃迁加速
        </p>
      </div>
    </div>
  );
}

export default function StarfieldExperience() {
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<WarpAudio | null>(null);
  const entered = useWarpUI((s) => s.entered);
  const setEntered = useWarpUI((s) => s.setEntered);
  const vignette = useRef<HTMLDivElement>(null);
  // Per-frame work (audio + vignette) is executed from StarfieldScene's
  // useFrame via this ref (#8): a second, parallel rAF loop raced R3F's own
  // loop and wrote DOM styles every frame.
  const onFrame = useRef<() => void>(() => {});

  useEffect(() => {
    // #12: no early-out when the root ref is missing — previously that skipped
    // audio creation too, leaving the experience permanently silent with no
    // signal why. Bind what we can, warn about what we can't.
    const root = rootRef.current;
    if (!root) {
      console.warn("[starfield] root element missing — input bindings skipped");
    }
    const unbind = root ? bindInput(root) : null;
    const audio = createWarpAudio();
    audioRef.current = audio;
    let lastVignette = -1;
    onFrame.current = () => {
      const n = Math.min(1, warp.speed / 780);
      audio.update(n, warp.boostAmt);
      if (vignette.current) {
        // Dirty check: only write the style when the opacity actually moved.
        const next = 0.55 + warp.boostAmt * 0.35;
        if (Math.abs(next - lastVignette) > 0.002) {
          lastVignette = next;
          vignette.current.style.opacity = String(next);
        }
      }
    };
    return () => {
      onFrame.current = () => {};
      unbind?.();
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  const enter = () => {
    if (warp.entered) return;
    setEntered(true);
    audioRef.current?.resume();
  };

  return (
    <div
      ref={rootRef}
      id="starwake-root"
      className="relative h-dvh w-full touch-none overflow-hidden bg-bg select-none"
    >
      <Canvas
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          depth: true,
        }}
        flat
        dpr={[1, 1.75]}
        camera={{ fov: 72, near: 0.08, far: 560, position: [0, 0, 0] }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor("#050508", 1);
          gl.toneMapping = THREE.NoToneMapping;
          camera.rotation.order = "YXZ";
        }}
      >
        <StarfieldScene onFrame={onFrame} />
      </Canvas>

      <div
        ref={vignette}
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 42%, color-mix(in oklab, var(--color-bg) 78%, transparent) 100%)",
          opacity: 0.55,
        }}
        aria-hidden
      />

      <Hud />
      {!entered ? <Intro onEnter={enter} /> : null}
    </div>
  );
}
