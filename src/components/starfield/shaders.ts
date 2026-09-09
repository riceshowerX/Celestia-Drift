export const STREAK_VS = /* glsl */ `
attribute vec3 aPos;
attribute float aSize;
attribute float aWarmth;

uniform vec3 uForward;
uniform float uTrail;
uniform float uPx;
uniform float uBoost;
uniform float uSpeed;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlong;

void main() {
  vUv = uv;
  vAlong = position.y;

  vec3 warm = vec3(1.0, 0.93, 0.84);
  vec3 cool = vec3(0.72, 0.84, 1.0);
  vColor = mix(warm, cool, aWarmth);
  vColor = mix(vColor, vec3(0.82, 0.93, 1.0), uBoost);

  vec3 head = aPos;
  float dist = max(length(head), 0.12);
  float trail = min(uTrail * aSize, dist * 0.88);
  vec3 tail = head + uForward * trail;

  vec4 hv = modelViewMatrix * vec4(head, 1.0);
  vec4 tv = modelViewMatrix * vec4(tail, 1.0);
  float depth = max(-hv.z, 0.06);
  float thick = uPx * depth * aSize * mix(2.35, 1.05, uSpeed);
  thick *= mix(1.0, 0.72, position.y);

  vec3 viewPos = mix(hv.xyz, tv.xyz, position.y);
  viewPos.x += (position.x - 0.5) * thick;

  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
}
`;

export const STREAK_FS = /* glsl */ `
// Precision is NOT hardcoded (#5): three prepends "precision <highp|mediump>
// float;" based on the device's actual capabilities (renderer.capabilities).
// Forcing "highp" here overrode that judgment and broke compilation on some
// older/low-end GLES2 devices that only guarantee mediump fragment precision.
// NOTE: ES3/GLES backends also need an explicit default float precision in the
// fragment stage; three injects it, so omitting it here is the correct move.

varying vec2 vUv;
varying vec3 vColor;
varying float vAlong;

uniform float uBoost;

void main() {
  float x = vUv.x * 2.0 - 1.0;
  float radial = exp(-x * x * 8.5);
  float head = exp(-vAlong * vAlong * 22.0);
  float tail = pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.45);
  float body = radial * mix(head * 1.9, tail, smoothstep(0.0, 0.22, vAlong));
  float core = exp(-x * x * 48.0) * exp(-vAlong * 14.0);
  float a = body + core * (1.55 + uBoost * 0.8);
  if (a < 0.012) discard;

  vec3 chroma = vColor;
  chroma.r += abs(x) * 0.12 * uBoost;
  chroma.b += (1.0 - abs(x)) * 0.08 * uBoost;

  vec3 col = chroma * (0.5 + core * 2.1 + uBoost * 0.45);
  gl_FragColor = vec4(col * a, a);
}
`;

export const NEBULA_VS = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FS = /* glsl */ `
// Precision injected by three per device capabilities (#5) — see STREAK_FS.

varying vec3 vDir;
uniform float uTime;

void main() {
  vec3 dir = normalize(vDir);
  float h = 0.5 + 0.5 * dir.y;
  vec3 top = vec3(0.008, 0.009, 0.014);
  vec3 bot = vec3(0.028, 0.032, 0.055);
  vec3 col = mix(bot, top, h);
  float band = pow(clamp(1.0 - abs(dir.y), 0.0, 1.0), 3.6);
  col += vec3(0.025, 0.032, 0.05) * band * 0.55;
  float swirl = 0.5 + 0.5 * sin(dir.x * 2.4 + dir.z * 1.7 + uTime * 0.05);
  col += vec3(0.01, 0.014, 0.024) * swirl * band;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const TUNNEL_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vObj;

void main() {
  vUv = uv;
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TUNNEL_FS = /* glsl */ `
// Precision injected by three per device capabilities (#5) — see STREAK_FS.

varying vec2 vUv;
varying vec3 vObj;
uniform float uTime;
uniform float uBoost;
uniform float uFlow;

void main() {
  float ang = atan(vObj.y, vObj.x);
  float ring = pow(abs(sin(ang * 18.0 + uTime * 0.35)), 28.0);
  float flow = fract(vUv.y * 5.0 - uTime * uFlow);
  float dash = smoothstep(0.0, 0.07, flow) * (1.0 - smoothstep(0.18, 0.5, flow));
  float fade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
  float a = ring * dash * fade * uBoost * 0.32;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.55, 0.72, 0.98), vec3(0.95, 0.97, 1.0), ring);
  gl_FragColor = vec4(col * a, a);
}
`;
