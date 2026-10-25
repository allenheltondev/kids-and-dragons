import { add, dot, mul, orient, unit } from "./dice-geometry";
import type { DieFace, DiePose, Vec3 } from "./dice-geometry";

type Point = readonly [number, number];
interface FacePaint {
  face: DieFace;
  image: HTMLCanvasElement;
  uv: Point[];
}
const SIZE = 256;
function paintFaces(
  faces: DieFace[],
  material?: HTMLImageElement,
): FacePaint[] {
  return faces.map((face) => {
    const image = document.createElement("canvas");
    image.width = image.height = SIZE;
    const c = image.getContext("2d")!;
    const radius = Math.max(
      ...face.vertices.map((p) => Math.hypot(...add(p, mul(face.center, -1)))),
    );
    const scale = 110 / radius;
    const uv = face.vertices.map((p): Point => {
      const d = add(p, mul(face.center, -1));
      return [128 + dot(d, face.right) * scale, 128 - dot(d, face.up) * scale];
    });
    const g = c.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, "#aa88d2");
    g.addColorStop(1, "#432652");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    if (material) c.drawImage(material, 0, 0, 256, 256);
    c.beginPath();
    uv.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.strokeStyle = "#593448";
    c.lineWidth = 19;
    c.lineJoin = "round";
    c.stroke();
    const rim = c.createLinearGradient(0, 0, 180, 256);
    rim.addColorStop(0, "#fff0b7");
    rim.addColorStop(0.35, "#c88e39");
    rim.addColorStop(0.6, "#f4cd77");
    rim.addColorStop(1, "#88522c");
    c.strokeStyle = rim;
    c.lineWidth = 14;
    c.stroke();
    c.strokeStyle = "#ffe5a2";
    c.lineWidth = 2;
    c.stroke();
    c.font = `bold ${face.vertices.length === 3 ? 76 : 88}px Georgia, serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = 6;
    c.strokeStyle = "#382040";
    c.strokeText(String(face.value), 128, 132);
    c.fillStyle = "#fff0c6";
    c.fillText(String(face.value), 128, 132);
    if (face.value === 6 || face.value === 9) {
      c.fillRect(112, 168, 32, 4);
    }
    return { face, image, uv };
  });
}

/** Map a triangle of the painted face into its projected plane, digits included. */
function triangle(
  c: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  src: Point[],
  dst: Point[],
): void {
  const [s0, s1, s2] = src as [Point, Point, Point],
    [d0, d1, d2] = dst as [Point, Point, Point];
  const sx1 = s1[0] - s0[0],
    sy1 = s1[1] - s0[1],
    sx2 = s2[0] - s0[0],
    sy2 = s2[1] - s0[1];
  const det = sx1 * sy2 - sx2 * sy1;
  if (Math.abs(det) < 1e-6) return;
  const dx1 = d1[0] - d0[0],
    dy1 = d1[1] - d0[1],
    dx2 = d2[0] - d0[0],
    dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det,
    b = (dy1 * sy2 - dy2 * sy1) / det,
    cc = (dx2 * sx1 - dx1 * sx2) / det,
    d = (dy2 * sx1 - dy1 * sx2) / det;
  c.save();
  c.beginPath();
  dst.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.clip();
  c.transform(
    a,
    b,
    cc,
    d,
    d0[0] - a * s0[0] - cc * s0[1],
    d0[1] - b * s0[0] - d * s0[1],
  );
  c.drawImage(image, 0, 0);
  c.restore();
}

export function createDieRenderer(
  canvas: HTMLCanvasElement,
  faces: DieFace[],
  value: number,
) {
  const c = canvas.getContext("2d");
  if (!c) return null;
  const target = faces.find((f) => f.value === value);
  if (!target) return null;
  let painted = paintFaces(faces);
  return {
    material(image: HTMLImageElement) {
      painted = paintFaces(faces, image);
    },
    draw(pose: DiePose, pixelRatio = 1) {
      const w = canvas.width / pixelRatio,
        h = canvas.height / pixelRatio,
        scale = w * 0.31;
      c.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      c.clearRect(0, 0, w, h);
      // View the tabletop from above: the result is the upper face, not a die balanced on a point.
      const view = (p: Vec3): Vec3 => [
        p[0],
        p[1] * Math.cos(0.32) + p[2] * Math.sin(0.32),
        -p[1] * Math.sin(0.32) + p[2] * Math.cos(0.32),
      ];
      const transformed = painted.map((p) => ({
        ...p,
        vertices: p.face.vertices.map((v) => view(orient(v, target, pose))),
        normal: view(orient(p.face.normal, target, pose)),
        center: view(orient(p.face.center, target, pose)),
      }));
      const projected = (p: Vec3): Point => [
        ((p[0] * 4.5) / (4.5 - p[2])) * scale,
        ((-p[1] * 4.5) / (4.5 - p[2])) * scale,
      ];
      const bottom = Math.max(
        ...transformed.flatMap((f) => f.vertices.map((p) => projected(p)[1])),
      );
      const x = w * 0.5 + pose.x * w * 0.17,
        ground = h * 0.93,
        y = ground - bottom - pose.lift * scale;
      // A faint lit tabletop receives the shadow; the background stays transparent.
      c.save();
      c.translate(w * 0.5, ground);
      c.scale(1, 0.28);
      const pool = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.48);
      pool.addColorStop(0, "rgba(176,134,201,.22)");
      pool.addColorStop(1, "rgba(89,51,120,0)");
      c.fillStyle = pool;
      c.fillRect(-w * 0.48, -w * 0.48, w * 0.96, w * 0.96);
      c.restore();
      // The shadow tightens and darkens at each of the four contacts.
      c.save();
      c.translate(x, ground);
      c.scale(1, 0.23);
      const r = w * (0.28 + pose.lift * 0.09),
        shadow = c.createRadialGradient(0, 0, 0, 0, 0, r);
      shadow.addColorStop(0, `rgba(6,3,13,${0.6 / (1 + pose.lift * 2)})`);
      shadow.addColorStop(0.5, "rgba(65,38,73,.24)");
      shadow.addColorStop(1, "rgba(6,3,13,0)");
      c.fillStyle = shadow;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.restore();
      const light = unit([-0.6, 0.85, 1.4]);
      transformed.sort((a, b) => a.center[2] - b.center[2]);
      for (const f of transformed) {
        if (dot(f.normal, add([0, 0, 4.5], mul(f.center, -1))) <= 0) continue;
        const dst = f.vertices.map((v): Point => {
          const p = projected(v);
          return [x + p[0], y + p[1]];
        });
        for (let i = 1; i < dst.length - 1; i++)
          triangle(
            c,
            f.image,
            [f.uv[0]!, f.uv[i]!, f.uv[i + 1]!],
            [dst[0]!, dst[i]!, dst[i + 1]!],
          );
        c.beginPath();
        dst.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
        c.closePath();
        const diffuse = Math.max(0, dot(f.normal, light));
        c.fillStyle = `rgba(12,5,25,${0.78 * (1 - diffuse)})`;
        c.fill();
        const shine =
          Math.max(0, dot(f.normal, unit(add(light, [0, 0, 1])))) ** 18;
        c.fillStyle = `rgba(255,234,185,${shine * 0.35})`;
        c.fill();
        c.strokeStyle = `rgba(255,224,153,${0.2 + diffuse * 0.65})`;
        c.lineWidth = Math.max(0.55, w / 360);
        c.lineJoin = "round";
        c.stroke();
      }
    },
  };
}
