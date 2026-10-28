/**
 * WhatWeStore (#252): what the game keeps about a family, who it belongs to,
 * and for how long, for the grown-up reading it.
 *
 * Its words live in `what-we-store.ts`, whose test holds them to the data
 * model and to what the stores write. Shown inside the sign-in panel, before
 * anybody signs in and from the organizer screen (`WhatWeStoreLink`), which
 * is already loaded on demand: nobody needs it to start a game, so it costs
 * first paint nothing (perf:bundle).
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { DELETING, ELSEWHERE, OWNER_LABEL, STORED } from "./what-we-store";
import "./WhatWeStore.css";

/** "What we store": opens the page in place, and closes it again. */
export function WhatWeStoreLink({ label = "What we store, and for how long" }: { label?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  if (open) return <WhatWeStore onClose={() => setOpen(false)} />;
  return (
    <button type="button" className="organizer__link stored__open kad-focusable" onClick={() => setOpen(true)}>
      {label}
    </button>
  );
}

export function WhatWeStore({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <section className="stored" aria-labelledby="stored-title">
      <div className="stored__page">
        <h2 className="stored__title" id="stored-title">
          What we store
        </h2>
        <p className="stored__lede">
          Kids &amp; Dragons keeps what the game needs to remember your party. Kids never sign in, but they do type a
          nickname and a hero name. The game checks those for bad words, not for personal details, so please help kids
          pick made-up names. A grown-up who wants to keep a game signs in with an email. What there is belongs to one
          of three owners: the kid, her hero, and the table she plays at. The privacy page explains why we keep it and
          who else handles it.
        </p>

        <section className="stored__section" aria-labelledby="stored-what">
          <h3 className="stored__heading" id="stored-what">
            What the game keeps
          </h3>
          <ul className="stored__list">
            {STORED.map((thing) => (
              <li className="stored__item" key={thing.title}>
                <h4 className="stored__item-title">
                  {thing.title}
                  <span className="stored__owner">{OWNER_LABEL[thing.owner]}</span>
                </h4>
                <p className="stored__what">{thing.what}</p>
                <p className="stored__kept">
                  <b>Kept:</b> {thing.kept}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="stored__section" aria-labelledby="stored-elsewhere">
          <h3 className="stored__heading" id="stored-elsewhere">
            Outside the game
          </h3>
          <ul className="stored__list">
            {ELSEWHERE.map((thing) => (
              <li className="stored__item" key={thing.title}>
                <h4 className="stored__item-title">{thing.title}</h4>
                <p className="stored__what">{thing.what}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="stored__section" aria-labelledby="stored-deleting">
          <h3 className="stored__heading" id="stored-deleting">
            Deleting
          </h3>
          <p className="stored__what">
            A signed-in grown-up deletes a kid or the whole household from &ldquo;Run a group&rdquo;, and can choose how
            long a kid who stops playing is kept.
          </p>
          <ul className="stored__bullets">
            {DELETING.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <Button variant="secondary" icon={<Icon name="back" />} onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  );
}
