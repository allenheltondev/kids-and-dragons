/**
 * The optional name a family gives its table ("Kitchen table", "Grandma's
 * house"): folded away behind a quiet link until asked for, so a family that
 * never names theirs never sees a form. Shared by the ordinary start screen and
 * the family tablet's, which are the two ways a TV is opened.
 */

import { useId, useState } from "react";
import type { ReactElement } from "react";
import { LOCATION_NAME_MAX } from "@kad/shared";
import { Icon } from "./icons";

export function TableNameField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const name = value.trim();

  if (!open) {
    return (
      <p className="home__hint kad-muted">
        {name !== "" ? <>{name} &middot; </> : null}
        <button type="button" className="home__link kad-focusable" onClick={() => setOpen(true)}>
          {name !== "" ? "change" : "Name your table (optional)"}
        </button>
      </p>
    );
  }
  return (
    <div className="home__field">
      <label className="home__label" htmlFor={fieldId}>
        <Icon name="name" />
        <span>Name your table (optional)</span>
      </label>
      <input
        id={fieldId}
        className="home__text-input kad-focusable"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Kitchen table"
        enterKeyHint="done"
        maxLength={LOCATION_NAME_MAX}
        autoFocus
      />
      <p className="home__hint kad-muted">
        Where your family plays, like the kitchen table or Grandma&rsquo;s house. Games you stop say where they were saved.
      </p>
    </div>
  );
}
