import type { ReactElement } from "react";
import { Icon } from "./icons";
import "./CrewIdentity.css";

/** A crew owns a continuing adventure; the party is tonight's lineup. */
export function CrewIdentity({ name, compact = false }: { name: string; compact?: boolean }): ReactElement {
  return (
    <div className={`crew-identity${compact ? " crew-identity--compact" : ""}`}>
      <Icon name="crew" className="crew-identity__art" />
      <div className="crew-identity__copy">
        <span className="crew-identity__label">Playing as</span>
        <strong className="crew-identity__name">{name}</strong>
        {compact ? null : <span className="crew-identity__hint">Your crew, your adventure saves.</span>}
      </div>
    </div>
  );
}
