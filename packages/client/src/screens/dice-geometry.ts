import { DICE_CONTACT_MS, DICE_TUMBLE_MS } from "../dice-timing";
export { DICE_CONTACT_MS } from "../dice-timing";
/** Small convex meshes and a deterministic throw; presentation never rolls game dice. */
export type Vec3 = readonly [number, number, number];
export interface DieFace {
  vertices: Vec3[];
  center: Vec3;
  normal: Vec3;
  up: Vec3;
  right: Vec3;
  value: number;
}
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const mul = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(...a));
const sub = (a: Vec3, b: Vec3): Vec3 => add(a, mul(b, -1));
const center = (vs: readonly Vec3[]): Vec3 =>
  mul(vs.reduce(add, [0, 0, 0]), 1 / vs.length);

/** Merge coplanar hull triangles into polygons (cube squares, d10 kites). */
function hull(points: Vec3[]): DieFace[] {
  const found = new Map<string, DieFace>();
  for (let a = 0; a < points.length; a++)
    for (let b = a + 1; b < points.length; b++)
      for (let c = b + 1; c < points.length; c++) {
        const pa = points[a]!,
          pb = points[b]!,
          pc = points[c]!;
        const raw = cross(sub(pb, pa), sub(pc, pa));
        if (Math.hypot(...raw) < 1e-6) continue;
        let n = unit(raw);
        let distance = dot(n, pa);
        const offsets = points.map((p) => dot(n, p) - distance);
        if (offsets.some((x) => x > 1e-5) && offsets.some((x) => x < -1e-5))
          continue;
        if (distance < 0) {
          n = mul(n, -1);
          distance = -distance;
        }
        const ids = points.flatMap((p, i) =>
          Math.abs(dot(n, p) - distance) < 1e-5 ? [i] : [],
        );
        const key = ids.join(",");
        if (found.has(key)) continue;
        const mid = center(ids.map((i) => points[i]!));
        const up = unit(sub(points[ids[0]!]!, mid));
        const right = unit(cross(up, n));
        const vertices = ids
          .map((i) => points[i]!)
          .sort(
            (p, q) =>
              Math.atan2(dot(sub(p, mid), up), dot(sub(p, mid), right)) -
              Math.atan2(dot(sub(q, mid), up), dot(sub(q, mid), right)),
          );
        found.set(key, {
          vertices,
          center: mid,
          normal: n,
          up,
          right,
          value: 0,
        });
      }
  return [...found.values()];
}

const meshes = new Map<number, DieFace[]>();
export function dieMesh(sides = 20): DieFace[] {
  const cached = meshes.get(sides);
  if (cached) return cached;
  let points: Vec3[] = [];
  if (sides === 4)
    points = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
  else if (sides === 6)
    for (const x of [-1, 1])
      for (const y of [-1, 1]) for (const z of [-1, 1]) points.push([x, y, z]);
  else if (sides === 8)
    points = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  else if (sides === 10) {
    // Dual of a regular pentagonal antiprism: the ten real kite faces of a d10.
    const side = 2 * Math.sin(Math.PI / 5),
      offset = 2 * Math.sin(Math.PI / 10);
    const h = Math.sqrt(side * side - offset * offset) / 2;
    const antiprism: Vec3[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      antiprism.push([Math.cos(angle), Math.sin(angle), i % 2 ? h : -h]);
    }
    points = hull(antiprism).map((f) =>
      mul(f.normal, 1 / dot(f.normal, f.center)),
    );
  } else if (sides === 20) {
    const g = (1 + Math.sqrt(5)) / 2;
    for (const a of [-1, 1])
      for (const b of [-g, g]) points.push([0, a, b], [a, b, 0], [b, 0, a]);
  } else throw new Error(`Unsupported die: d${sides}`);
  const radius = Math.max(...points.map((p) => Math.hypot(...p)));
  const faces = hull(points.map((p) => mul(p, 1 / radius)));
  let low = 1;
  for (const f of faces) {
    if (f.value) continue;
    f.value = low;
    const opposite = faces.find(
      (o) => o !== f && !o.value && dot(f.normal, o.normal) < -0.999,
    );
    if (opposite) opposite.value = sides + 1 - low;
    low++;
  }
  meshes.set(sides, faces);
  return faces;
}

/** Contacts match the six wooden ticks in the slowed dice sample. */

export interface DiePose {
  rotate: Vec3;
  x: number;
  lift: number;
}
export function throwPose(progress: number, seed = 0): DiePose {
  const t = Math.min(1, Math.max(0, progress));
  const contacts = [0, ...DICE_CONTACT_MS.map((ms) => ms / DICE_TUMBLE_MS), 1];
  const heights = [0.95, 0.58, 0.38, 0.24, 0.13, 0.06, 0.018];
  let segment = 0;
  while (segment < contacts.length - 2 && t > contacts[segment + 1]!) segment++;
  const u =
    (t - contacts[segment]!) / (contacts[segment + 1]! - contacts[segment]!);
  const lift =
    segment === 0
      ? heights[0]! * (1 - u * u)
      : heights[segment]! * 4 * u * (1 - u);
  const remaining = (1 - t) ** 2;
  const variation = (seed % 7) / 7;
  const wobble =
    t > 0.78 ? Math.sin((t - 0.78) * Math.PI * 8) * (1 - t) * 0.4 : 0;
  return {
    rotate: [
      remaining * Math.PI * (1.8 + variation * 0.25),
      remaining * Math.PI * (2.4 - variation * 0.25),
      remaining * Math.PI * 0.65 + wobble,
    ],
    x: -0.95 * (1 - t) ** 2,
    lift,
  };
}

/** Rotate a real mesh so the requested face ends square to the camera, upright. */
export function orient(p: Vec3, target: DieFace, pose: DiePose): Vec3 {
  let x = dot(p, target.right),
    y = dot(p, target.up),
    z = dot(p, target.normal);
  let c = Math.cos(pose.rotate[0]),
    s = Math.sin(pose.rotate[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(pose.rotate[1]);
  s = Math.sin(pose.rotate[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(pose.rotate[2]);
  s = Math.sin(pose.rotate[2]);
  return [x * c - y * s, x * s + y * c, z];
}
