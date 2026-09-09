import * as THREE from "three";
import { pollGamepad } from "./input";
import {
  STREAK_FS,
  STREAK_VS,
  NEBULA_FS,
  NEBULA_VS,
  TUNNEL_FS,
  TUNNEL_VS,
} from "./shaders";
import { maxStarCount, starCount, useWarpUI, warp } from "./state";

const DUST_COUNT = 1800;
const RADIUS = 210;
const RADIUS2 = RADIUS * RADIUS;
const SPAWN_NEAR = 36;
const SPAWN_RANGE = 168;
// Never fewer than this many instances rendered, even under perf pressure.
// (Declared BEFORE createEngine (#4) — it used to live at the bottom of the
// file, relying on closure-time evaluation to dodge the TDZ.)
const MIN_RUNTIME = 500;

export type Engine = {
  group: THREE.Group;
  update: (
    dt: number,
    camera: THREE.Camera,
    gl: THREE.WebGLRenderer,
    size: { width: number; height: number },
  ) => void;
  dispose: () => void;
};

function makeGlowTexture() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) {
    // Fallback texture renders as an empty (transparent) canvas texture —
    // dust points become invisible but the scene still draws (#8).
    console.warn("[starfield] canvas 2d context unavailable — glow texture disabled");
    return new THREE.Texture();
  }
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.16, "rgba(230,238,255,0.55)");
  grd.addColorStop(0.4, "rgba(150,175,210,0.12)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fillSphere(pos: Float32Array, count: number, radius: number) {
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let m2 = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      m2 = x * x + y * y + z * z;
    } while (m2 > 1 || m2 < 1e-4);
    const s = radius * Math.cbrt(Math.random()) / Math.sqrt(m2);
    const i3 = i * 3;
    pos[i3] = x * s;
    pos[i3 + 1] = y * s;
    pos[i3 + 2] = z * s;
  }
}

function basis(fx: number, fy: number, fz: number) {
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  let rm = Math.hypot(rx, rz);
  if (rm < 1e-4) {
    rx = 1;
    ry = 0;
    rz = 0;
    rm = 1;
  } else {
    rx /= rm;
    rz /= rm;
  }
  let ux = ry * fz - rz * fy;
  let uy = rz * fx - rx * fz;
  let uz = rx * fy - ry * fx;
  const um = Math.hypot(ux, uy, uz) || 1;
  ux /= um;
  uy /= um;
  uz /= um;
  return { rx, ry, rz, ux, uy, uz };
}

function recycle(
  pos: Float32Array,
  i: number,
  fx: number,
  fy: number,
  fz: number,
  b: ReturnType<typeof basis>,
) {
  const i3 = i * 3;
  if (Math.random() < 0.14) {
    let x = 0, y = 0, z = 0, m2 = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      m2 = x * x + y * y + z * z;
    } while (m2 > 1 || m2 < 1e-4);
    const s = RADIUS * (0.35 + Math.random() * 0.6) / Math.sqrt(m2);
    pos[i3] = x * s;
    pos[i3 + 1] = y * s;
    pos[i3 + 2] = z * s;
    return;
  }
  const a = Math.random() * Math.PI * 2;
  const depth = SPAWN_NEAR + Math.random() * SPAWN_RANGE;
  const r = Math.sqrt(Math.random()) * (depth * 1.05 + 28);
  const ca = Math.cos(a) * r;
  const sa = Math.sin(a) * r;
  pos[i3] = fx * depth + b.rx * ca + b.ux * sa;
  pos[i3 + 1] = fy * depth + b.ry * ca + b.uy * sa;
  pos[i3 + 2] = fz * depth + b.rz * ca + b.uz * sa;
}

export function createEngine(): Engine {
  const group = new THREE.Group();

  const streakGeo = new THREE.InstancedBufferGeometry();
  const verts = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  streakGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  streakGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  streakGeo.setIndex(new THREE.BufferAttribute(idx, 1));

  // Buffers are allocated for the device cap at engine-creation time (#31).
  // If the cap grows later (resize), starCount() is clamped back to this
  // allocation in update() so no instance references unallocated positions.
  const starCap = maxStarCount();
  const starPos = new Float32Array(starCap * 3);
  const starSize = new Float32Array(starCap);
  const starWarm = new Float32Array(starCap);
  fillSphere(starPos, starCap, RADIUS * 0.96);
  for (let i = 0; i < starCap; i++) {
    const giant = Math.random() > 0.97;
    starSize[i] = (0.55 + Math.pow(Math.random(), 2.4) * 2.2) * (giant ? 2.4 : 1);
    starWarm[i] = Math.random();
  }

  const aPos = new THREE.InstancedBufferAttribute(starPos, 3);
  aPos.setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.InstancedBufferAttribute(starSize, 1);
  const aWarmth = new THREE.InstancedBufferAttribute(starWarm, 1);
  streakGeo.setAttribute("aPos", aPos);
  streakGeo.setAttribute("aSize", aSize);
  streakGeo.setAttribute("aWarmth", aWarmth);
  streakGeo.instanceCount = starCount();

  const streakMat = new THREE.ShaderMaterial({
    vertexShader: STREAK_VS,
    fragmentShader: STREAK_FS,
    uniforms: {
      uForward: { value: new THREE.Vector3(0, 0, -1) },
      uTrail: { value: 8 },
      uPx: { value: 0.002 },
      uBoost: { value: 0 },
      uSpeed: { value: 0.3 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const streaks = new THREE.Mesh(streakGeo, streakMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 2;
  group.add(streaks);

  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustSize = new Float32Array(DUST_COUNT);
  fillSphere(dustPos, DUST_COUNT, RADIUS * 0.9);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustSize[i] = 0.35 + Math.random() * 1.4;
  }
  const dustGeo = new THREE.BufferGeometry();
  const dustPosAttr = new THREE.BufferAttribute(dustPos, 3);
  dustPosAttr.setUsage(THREE.DynamicDrawUsage);
  dustGeo.setAttribute("position", dustPosAttr);
  const glowTex = makeGlowTexture();
  const dustMat = new THREE.PointsMaterial({
    map: glowTex,
    size: 1.15,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    color: 0xb7c8dc,
    sizeAttenuation: true,
    opacity: 0.72,
    toneMapped: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  group.add(dust);

  const skyGeo = new THREE.SphereGeometry(380, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VS,
    fragmentShader: NEBULA_FS,
    uniforms: { uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  group.add(sky);

  const tunGeo = new THREE.CylinderGeometry(17, 17, 250, 48, 1, true);
  tunGeo.rotateX(Math.PI / 2);
  const tunMat = new THREE.ShaderMaterial({
    vertexShader: TUNNEL_VS,
    fragmentShader: TUNNEL_FS,
    uniforms: {
      uTime: { value: 0 },
      uBoost: { value: 0 },
      uFlow: { value: 1.4 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const tunnel = new THREE.Mesh(tunGeo, tunMat);
  tunnel.frustumCulled = false;
  tunnel.renderOrder = -1;
  group.add(tunnel);

  let time = 0;
  let prevBoost = false;
  let uiAcc = 0;
  let emaDt = 1 / 60;
  let perfMul = 1;
  let warnedNonPerspectiveCamera = false;

  const fwd = new THREE.Vector3();

  const update = (
    dt: number,
    camera: THREE.Camera,
    gl: THREE.WebGLRenderer,
    size: { width: number; height: number },
  ) => {
    pollGamepad();
    // uTime wrap (#6): every shader consumer of `time` is periodic, so the
    // exact wrap point is irrelevant — but letting the float grow unbounded
    // loses precision after hours of runtime (sin() of a huge float degrades
    // into visible stepping). Cost: one harmless pattern discontinuity per
    // wrap, vs. steadily degrading visuals without it.
    time = (time + dt) % 3600;
    emaDt = emaDt * 0.92 + dt * 0.08;

    const keys = warp.qaKeys ?? warp.keys;
    let steer = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) steer += 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) steer -= 1;
    if (warp.qaSteer !== null) steer = warp.qaSteer;

    if (keys.has("KeyW") || keys.has("ArrowUp")) {
      warp.cruise = Math.min(1, warp.cruise + 0.38 * dt);
    }
    if (keys.has("KeyS") || keys.has("ArrowDown")) {
      warp.cruise = Math.max(0.05, warp.cruise - 0.38 * dt);
    }

    const held =
      warp.boostHeld ||
      warp.padBoost ||
      keys.has("Space") ||
      keys.has("ShiftLeft") ||
      keys.has("ShiftRight");
    const boostTarget = held ? 1 : 0;
    const boostK = held ? 3.4 : 2.2;
    warp.boostAmt +=
      (boostTarget - warp.boostAmt) * (1 - Math.exp(-boostK * dt));
    if (warp.boostAmt < 0.001) warp.boostAmt = 0;
    if (warp.boostAmt > 0.48 && !prevBoost) warp.trauma = 0.42;
    prevBoost = warp.boostAmt > 0.48;

    warp.trauma = Math.max(0, warp.trauma - dt * 1.85);

    const cruiseUnits = 24 + warp.cruise * 155;
    warp.speed = cruiseUnits * (1 + warp.boostAmt * 7.2);

    let lx = warp.lookX;
    let ly = warp.lookY;
    // Dead branch removed (#7): the old `warp.touchLook === false` disjunct
    // made the condition `A || !B` where the body only acted on `A` — the
    // touchLook term was a no-op. Simplified to the intent: recentre the view
    // only when the pointer left the canvas.
    if (!warp.pointerInside && !warp.qaKeys) {
      warp.lookX += (0 - warp.lookX) * (1 - Math.exp(-3.2 * dt));
      warp.lookY += (0 - warp.lookY) * (1 - Math.exp(-3.2 * dt));
      lx = warp.lookX;
      ly = warp.lookY;
    }

    const mag = Math.hypot(lx, ly);
    let sx = 0;
    let sy = 0;
    const dead = 0.055;
    if (mag > dead) {
      const s = (mag - dead) / (1 - dead);
      sx = (lx / mag) * Math.min(1, s);
      sy = (ly / mag) * Math.min(1, s);
    }

    const turn = 1.15;
    warp.yaw += (-sx * turn + steer * 1.65) * dt;
    warp.pitch = Math.max(
      -1.12,
      Math.min(1.12, warp.pitch + sy * 0.95 * dt),
    );
    const rollTarget = warp.reducedMotion ? 0 : -sx * 0.22 - steer * 0.12;
    warp.roll += (rollTarget - warp.roll) * (1 - Math.exp(-5 * dt));

    // Runtime camera check (#3): the old unchecked `as` cast would happily
    // write fov/rotation onto an OrthographicCamera (no .fov damage but wrong
    // semantics) or a NaN-tainted camera, poisoning the projection matrix.
    // Skip the frame and warn once — a wrong camera is a wiring bug, not a
    // per-frame condition.
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      if (!warnedNonPerspectiveCamera) {
        warnedNonPerspectiveCamera = true;
        console.warn(
          "[starfield] camera is not a PerspectiveCamera — skipping warp camera updates",
        );
      }
      return;
    }
    const persp = camera;
    persp.rotation.order = "YXZ";
    persp.rotation.y = warp.yaw;
    persp.rotation.x = warp.pitch;
    persp.rotation.z = warp.roll;
    persp.position.set(0, 0, 0);
    if (!warp.reducedMotion && warp.trauma > 0.002) {
      const sh = warp.trauma * warp.trauma;
      persp.position.x += (Math.random() - 0.5) * sh * 0.14;
      persp.position.y += (Math.random() - 0.5) * sh * 0.14;
    }

    const targetFov = warp.reducedMotion
      ? 70
      : 67 + warp.cruise * 5 + warp.boostAmt * 18;
    persp.fov += (targetFov - persp.fov) * (1 - Math.exp(-5.5 * dt));
    persp.updateProjectionMatrix();
    persp.getWorldDirection(fwd);

    const fx = fwd.x;
    const fy = fwd.y;
    const fz = fwd.z;
    const b = basis(fx, fy, fz);

    if (emaDt > 0.024) perfMul = Math.max(0.62, perfMul - dt * 0.35);
    else if (emaDt < 0.015) perfMul = Math.min(1, perfMul + dt * 0.2);

    // Clamp the rendered instance count to the allocated buffer (#31): the
    // device cap can grow on resize, but these typed arrays were sized at
    // engine creation — instances beyond the allocation would read zeroed
    // positions and pile up at the origin.
    const count = Math.min(
      starSize.length,
      Math.max(MIN_RUNTIME, Math.round(starCount() * perfMul)),
    );
    streakGeo.instanceCount = count;

    const step = warp.speed * dt;
    const dustStep = step * 0.38;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      starPos[i3] -= fx * step;
      starPos[i3 + 1] -= fy * step;
      starPos[i3 + 2] -= fz * step;
      const x = starPos[i3];
      const y = starPos[i3 + 1];
      const z = starPos[i3 + 2];
      const dot = x * fx + y * fy + z * fz;
      const d2 = x * x + y * y + z * z;
      if (dot < -14 || d2 > RADIUS2 || d2 < 0.55) {
        recycle(starPos, i, fx, fy, fz, b);
      }
    }
    // Incremental upload (#2): only the rendered instance range [0, count)
    // changes per frame and is visible — a full MAX-capacity re-upload pushed
    // ~154KB/frame (~9MB/s) down the bus for nothing. three clears the update
    // range after upload, so re-registering each frame is the contract.
    aPos.clearUpdateRanges();
    aPos.addUpdateRange(0, count * 3);
    aPos.needsUpdate = true;

    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      dustPos[i3] -= fx * dustStep;
      dustPos[i3 + 1] -= fy * dustStep;
      dustPos[i3 + 2] -= fz * dustStep;
      const x = dustPos[i3];
      const y = dustPos[i3 + 1];
      const z = dustPos[i3 + 2];
      const dot = x * fx + y * fy + z * fz;
      const d2 = x * x + y * y + z * z;
      if (dot < -16 || d2 > RADIUS2 || d2 < 0.4) {
        recycle(dustPos, i, fx, fy, fz, b);
      }
    }
    // Dust always animates every instance, so a full upload is inherent here
    // (incremental ranges only pay off for the partially-active star buffer).
    dustPosAttr.needsUpdate = true;

    const speedK = Math.min(1, warp.speed / 780);
    const trailMul = warp.reducedMotion ? 0.35 : 1;
    const trailWorld =
      (3.2 + speedK * 68 * warp.trail) * (1 + warp.boostAmt * 0.85) * trailMul;
    const uPx =
      (2 * Math.tan(((persp.fov * Math.PI) / 180) * 0.5)) /
      Math.max(size.height, 1);

    streakMat.uniforms.uForward.value.set(fx, fy, fz);
    streakMat.uniforms.uTrail.value = trailWorld;
    streakMat.uniforms.uPx.value = uPx;
    streakMat.uniforms.uBoost.value = warp.boostAmt;
    streakMat.uniforms.uSpeed.value = speedK;

    skyMat.uniforms.uTime.value = time;
    tunMat.uniforms.uTime.value = time;
    tunMat.uniforms.uBoost.value = warp.boostAmt;
    tunMat.uniforms.uFlow.value = 0.8 + speedK * 3.4 + warp.boostAmt * 4.5;
    tunnel.quaternion.copy(camera.quaternion);
    tunnel.visible = warp.boostAmt > 0.04 && !warp.reducedMotion;

    // DPR is owned by R3F's `dpr={[1, 1.75]}` (#13): the engine's own adaptive
    // setPixelRatio raced it (two writers, one canvas), producing resolution
    // flicker after HMR or scene remounts.

    uiAcc += dt;
    if (uiAcc > 0.12) {
      uiAcc = 0;
      const ui = useWarpUI.getState();
      if (Math.abs(ui.cruise - warp.cruise) > 0.008) {
        useWarpUI.setState({ cruise: warp.cruise });
      }
    }

    // Dev-only test hook (#7/#21): keeps the production `window` clean.
    if (import.meta.env.DEV && !window.__warpReady) window.__warpReady = true;
  };

  const dispose = () => {
    streakGeo.dispose();
    streakMat.dispose();
    dustGeo.dispose();
    dustMat.dispose();
    glowTex.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    tunGeo.dispose();
    tunMat.dispose();
  };

  return { group, update, dispose };
}
