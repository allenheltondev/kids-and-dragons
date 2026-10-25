import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { reducedMotion } from "../a11y/prefs";
import enamel from "../assets/dice/enamel.webp";
import { dieMesh, throwPose } from "./dice-geometry";
import { createDieRenderer } from "./dice-renderer";
import { Icon } from "./icons";

let material: Promise<HTMLImageElement | undefined> | undefined;
function loadMaterial(): Promise<HTMLImageElement | undefined> {
  return (material ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = enamel;
  }));
}

/** A real projected polyhedron. React owns the event, never the animation frames. */
export function AnimatedDie({
  value,
  sides = 20,
  duration,
  seed,
  landed,
}: {
  value: number;
  sides?: number;
  duration: number;
  seed: number;
  landed: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const canvas = canvasRef.current;
    // A readable painted fallback also covers servers, jsdom and disabled canvas.
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    let renderer: ReturnType<typeof createDieRenderer>;
    try {
      renderer = createDieRenderer(canvas, dieMesh(sides), value);
    } catch {
      return;
    }
    if (!renderer) return;
    const painter = renderer;
    const start = performance.now();
    let frame = 0,
      disposed = false,
      ratio = 1;
    const progress = () =>
      reducedMotion() ? 1 : Math.min(1, (performance.now() - start) / duration);
    const draw = () => {
      painter.draw(throwPose(progress(), seed), ratio);
    };
    const tick = () => {
      draw();
      if (progress() < 1 && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      draw();
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      draw();
      if (progress() < 1 && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    const motion = new MutationObserver(restart);
    motion.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    const media =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    media?.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("resize", resize);
    resize();
    setReady(true);
    restart();
    void loadMaterial()
      .then((image) => {
        if (disposed || !image) return;
        painter.material(image);
        draw();
      })
      .catch(() => {
        // Enamel is optional: retain the valid procedural faces if painting fails.
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      motion.disconnect();
      media?.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("resize", resize);
    };
  }, [value, sides, duration, seed]);
  return (
    <span
      className={`polyhedral-die${ready ? " polyhedral-die--ready" : ""}`}
      aria-hidden="true"
    >
      <span className="polyhedral-die__fallback">
        <Icon name={sides === 6 ? "dice" : "d20_solid"} size="100%" />
        <b>{landed ? value : ""}</b>
      </span>
      <canvas
        ref={canvasRef}
        className="polyhedral-die__canvas"
        data-sides={sides}
        data-value={value}
      />
    </span>
  );
}
