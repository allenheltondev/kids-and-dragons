import { Component, Suspense, lazy, type ReactNode } from "react";

// Loaded only when the renderer failed: a screen that draws the real board
// never downloads the still one.
const StaticStage = lazy(() =>
  import("./StaticStage").then((module) => ({ default: module.StaticStage })),
);

/** A still board that itself breaks is just the warning again. Reported, quietly (#329). */
class StaticBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error): void { globalThis.reportError?.(error); }
  override render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

export function RendererFallback(): React.JSX.Element {
  return (
    <>
      <StaticBoundary>
        <Suspense fallback={null}>
          <StaticStage />
        </Suspense>
      </StaticBoundary>
      {/* Minimal on purpose: a small red warning in the corner, not a message over the
          board. The still board is the picture now, and the game plays on. */}
      <div className="kad-stage-warning" role="status" title="Something went wrong">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3 2 20.5h20Z" fill="currentColor" />
          <path d="M12 9.5v5M12 17.2v.3" stroke="var(--kad-bg)" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <span className="kad-sr-only">Something went wrong with the moving picture. You can still play.</span>
      </div>
    </>
  );
}

/** Keep a failed renderer chunk or render isolated from the game panels. */
export class RendererBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  // Caught, so the window `error` event the reporter listens for (#322) never fires on its own.
  override componentDidCatch(error: Error): void {
    globalThis.reportError?.(error);
  }

  override render(): ReactNode {
    return this.state.failed ? <RendererFallback /> : this.props.children;
  }
}
