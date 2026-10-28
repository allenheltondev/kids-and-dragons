/**
 * The privacy policy (`/privacy`, #523): a public page for the grown-up, linked
 * from the start screens so it can be read before anybody joins or hosts. Its
 * words are `privacy-policy.ts`; who runs the game is `operator.ts`. A chunk of
 * its own, like the guide, since nobody on the join screen is waiting for it.
 */

import { useEffect } from "react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { navigate } from "../router";
import { Icon } from "./icons";
import { OPERATOR } from "./operator";
import { PRIVACY_LEDE, PRIVACY_SECTIONS, PRIVACY_UPDATED } from "./privacy-policy";
import { WhatWeStoreLink } from "./WhatWeStore";
import "../guide/GuideScreen.css";
import "./PrivacyScreen.css";

/** Who runs the game: the operator's own words, or a plain statement that they are not filled in. */
export function OperatorLines({ name = OPERATOR.name, contact = OPERATOR.contact }: { name?: string; contact?: string }): ReactElement {
  if (name === "" || contact === "") {
    return (
      <p className="guide__p privacy__missing">
        The name and contact address of whoever runs Kids &amp; Dragons have not been published yet. Until they are, there is
        no one here to write to about privacy.
      </p>
    );
  }
  return (
    <p className="guide__p">
      Kids &amp; Dragons is run by {/[.!?]$/.test(name) ? name : `${name}.`} Write to{" "}
      <a href={`mailto:${contact}`}>{contact}</a> with privacy questions.
    </p>
  );
}

export default function PrivacyScreen(): ReactElement {
  useEffect(() => {
    const before = document.title;
    document.title = "Privacy | Kids & Dragons";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <main className="guide" aria-labelledby="privacy-title">
      <article className="guide__page">
        <div className="guide__actions">
          <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate({ name: "home" })}>
            Back to the start
          </Button>
        </div>

        <h1 className="guide__title" id="privacy-title">
          Privacy
        </h1>
        <p className="guide__p">Last updated {PRIVACY_UPDATED}.</p>
        <p className="guide__p">{PRIVACY_LEDE}</p>

        <section className="guide__section guide__section--first" aria-labelledby="privacy-who">
          <h2 className="guide__h2" id="privacy-who">
            Who runs this
          </h2>
          <OperatorLines />
        </section>

        {PRIVACY_SECTIONS.map((section) => (
          <section className="guide__section" key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
            <h2 className="guide__h2" id={`${section.id}-title`}>
              {section.title}
            </h2>
            {section.paragraphs?.map((text) => (
              <p className="guide__p" key={text}>
                {text}
              </p>
            ))}
            {section.bullets ? (
              <ul className="privacy__bullets">
                {section.bullets.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section className="guide__section" aria-labelledby="privacy-stored">
          <h2 className="guide__h2" id="privacy-stored">
            Exactly what is stored
          </h2>
          <WhatWeStoreLink label="What we store, and for how long" />
        </section>
      </article>
    </main>
  );
}
