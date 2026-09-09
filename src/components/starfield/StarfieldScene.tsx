import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import { createEngine, type Engine } from "./engine";

/**
 * Owns the warp engine inside the R3F tree.
 *
 * WebGL context loss (#1): three's WebGLRenderer already preventDefaults and
 * fully re-initializes its GL state on restore (fresh WebGLAttributes etc.),
 * but the ENGINE's per-frame CPU simulation must pause while the context is
 * gone — updates during the lost window would mutate buffers nobody can
 * upload, desyncing the sim. We pause on `webglcontextlost` and resume on
 * `webglcontextrestored`; three re-uploads our buffers on the next render.
 */
export function StarfieldScene({
  onFrame,
}: {
  /** Extra per-frame work (audio + HUD-adjacent DOM), run from useFrame. */
  onFrame?: MutableRefObject<() => void>;
} = {}) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const engine = useRef<Engine | null>(null);
  const contextLost = useRef(false);

  useLayoutEffect(() => {
    const e = createEngine();
    scene.add(e.group);
    engine.current = e;
    return () => {
      scene.remove(e.group);
      e.dispose();
      engine.current = null;
    };
  }, [scene]);

  // Context-loss wiring + `gl` dependency (#87): `gl` is read below for the
  // canvas element, so it belongs in the deps — an omitted dep here meant a
  // renderer swap (StrictMode double-mount, HMR) silently detached listeners.
  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault(); // allow restore
      contextLost.current = true;
      console.warn("[starfield] WebGL context lost — simulation paused");
    };
    const onRestored = () => {
      contextLost.current = false;
      console.warn("[starfield] WebGL context restored — simulation resumed");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl]);

  useFrame((state, delta) => {
    if (contextLost.current) return; // paused while the context is gone
    const d = Math.min(delta, 0.05);
    engine.current?.update(d, state.camera, gl, state.size);
    onFrame?.current();
  });

  return null;
}
