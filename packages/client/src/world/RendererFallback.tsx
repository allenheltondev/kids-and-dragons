import { Component, Suspense, lazy, type ReactNode } from "react";

// Loaded only when the renderer failed: a screen that draws the real board
// never downloads the still one.
const StaticStage = lazy(() =>
  import("./StaticStage").then((module) => ({ default: module.StaticStage })),
);

/** A still board that itself breaks is just the message again. */
class StaticBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
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
      <div className="kad-stage-fallback" role="status">
        <p>The world view couldn’t load. You can still play using the game controls.</p>
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

  override render(): ReactNode {
    return this.state.failed ? <RendererFallback /> : this.props.children;
  }
}
