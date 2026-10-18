/** The read-aloud switch: one icon button on every screen, beside sound. */

import { Button } from "../ui";
import { Icon } from "../screens/icons";
import { useReadAloud } from "./read-aloud";

import "./ReadAloudControl.css";

export function ReadAloudControl(): React.JSX.Element | null {
  const { supported, on, setOn } = useReadAloud();
  if (!supported) return null;
  return (
    <div className="kad-readaloud">
      <Button
        className="kad-readaloud__button"
        variant="ghost"
        size="md"
        aria-label={on ? "Turn read-aloud off" : "Turn read-aloud on"}
        aria-pressed={on}
        icon={<Icon name={on ? "readaloud-on" : "readaloud"} />}
        onClick={() => setOn(!on)}
      />
    </div>
  );
}
