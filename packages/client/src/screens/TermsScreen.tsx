/**
 * The terms of use (`/terms`): a public page for the grown-up, beside the
 * privacy policy in the footer. Its words are `terms-of-use.ts` (a draft, not yet
 * reviewed by a lawyer, as the page itself says); who runs the game is
 * `operator.ts`. It borrows the privacy page's layout and a chunk of its own,
 * since nobody on the join screen is waiting for it.
 */

import { useEffect } from "react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { navigate } from "../router";
import { Icon } from "./icons";
import { OperatorLines } from "./PrivacyScreen";
import { TERMS_LEDE, TERMS_SECTIONS, TERMS_UPDATED } from "./terms-of-use";
import "../guide/GuideScreen.css";
import "./PrivacyScreen.css";

export default function TermsScreen(): ReactElement {
  useEffect(() => {
    const before = document.title;
    document.title = "Terms of use | Kids & Dragons";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <main className="guide" aria-labelledby="terms-title">
      <article className="guide__page">
        <div className="guide__actions">
          <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate({ name: "home" })}>
            Back to the start
          </Button>
        </div>

        <h1 className="guide__title" id="terms-title">
          Terms of use
        </h1>
        <p className="guide__p">Last updated {TERMS_UPDATED}.</p>
        <p className="guide__p">{TERMS_LEDE}</p>

        <section className="guide__section guide__section--first" aria-labelledby="terms-who">
          <h2 className="guide__h2" id="terms-who">
            Who runs this
          </h2>
          <OperatorLines about="questions about these terms" />
        </section>

        {TERMS_SECTIONS.map((section) => (
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

        <section className="guide__section" aria-labelledby="terms-privacy">
          <h2 className="guide__h2" id="terms-privacy">
            Privacy
          </h2>
          <p className="guide__p">
            What the game collects, and what you can do about it, is on the <a href="/privacy">privacy page</a>.
          </p>
        </section>
      </article>
    </main>
  );
}
