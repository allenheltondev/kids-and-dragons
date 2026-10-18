/**
 * WhatWeStore — `/what-we-store` (#252): what the game keeps about a family,
 * who it belongs to, and for how long, for the grown-up reading it.
 *
 * Its words live in `what-we-store.ts`, whose test holds them to the data
 * model and to what the stores write. Loaded on demand: nobody needs it to
 * start a game.
 */

import type { ReactElement } from "react";
import { navigate } from "../router";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { DELETING, ELSEWHERE, OWNER_LABEL, STORED } from "./what-we-store";
import "./WhatWeStore.css";

export function WhatWeStore(): ReactElement {
  return (
    <main className="stored">
      <div className="stored__page">
        <h1 className="stored__title">What we store</h1>
        <p className="stored__lede">
          Kids &amp; Dragons keeps only what the game needs to remember your party. Kids never sign in and never type
          anything personal: a grown-up who wants to keep a game signs in, and the kids are nicknames that grown-up
          keeps. What there is belongs to one of three owners: the kid, her hero, and the table she plays at.
        </p>

        <section className="stored__section" aria-labelledby="stored-what">
          <h2 className="stored__heading" id="stored-what">
            What the game keeps
          </h2>
          <ul className="stored__list">
            {STORED.map((thing) => (
              <li className="stored__item" key={thing.title}>
                <h3 className="stored__item-title">
                  {thing.title}
                  <span className="stored__owner">{OWNER_LABEL[thing.owner]}</span>
                </h3>
                <p className="stored__what">{thing.what}</p>
                <p className="stored__kept">
                  <b>Kept:</b> {thing.kept}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="stored__section" aria-labelledby="stored-elsewhere">
          <h2 className="stored__heading" id="stored-elsewhere">
            Outside the game
          </h2>
          <ul className="stored__list">
            {ELSEWHERE.map((thing) => (
              <li className="stored__item" key={thing.title}>
                <h3 className="stored__item-title">{thing.title}</h3>
                <p className="stored__what">{thing.what}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="stored__section" aria-labelledby="stored-deleting">
          <h2 className="stored__heading" id="stored-deleting">
            Deleting
          </h2>
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

        <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate("/")}>
          Back to the game
        </Button>
      </div>
    </main>
  );
}
