/**
 * The frame around the world (and the map) when it sits beside the controls on a tablet held
 * sideways (landscape.ts): filigree in the four corners and a soft dark edge, so the picture reads
 * as a window in the book. Decoration only; styles/chrome.css draws it, and only side by side.
 */
export function PaneFrame(): React.JSX.Element {
  return (
    <div className="kad-pane-frame" aria-hidden="true">
      <span className="kad-pane-frame__corner" />
      <span className="kad-pane-frame__corner" />
      <span className="kad-pane-frame__corner" />
      <span className="kad-pane-frame__corner" />
    </div>
  );
}
