import { Component, type ReactNode } from "react";

export function RendererFallback(): React.JSX.Element {
  return (
    <div className="kad-stage-fallback" role="status">
      <p>The world view couldn’t load. You can still play using the game controls.</p>
    </div>
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
