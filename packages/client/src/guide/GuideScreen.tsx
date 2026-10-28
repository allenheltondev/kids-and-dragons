/**
 * GuideScreen (`/guide`, #257): how to run a session, for a grown-up who has
 * never seen the game.
 *
 * The words are `guide.md` beside this file, the one source for the screen,
 * the printed page and the copy GitHub shows. The pictures are real screens,
 * taken by the e2e specs (`npm run guide:pictures`, docs/guide/README.md) and
 * served from `/guide-pictures/`. The whole screen is a lazy chunk: nobody on
 * the join screen needs it (tools/perf/bundle-budget.ts).
 *
 * The same page is the printable one. "Print this guide" opens the browser's
 * print dialog, and the print styles drop the buttons and the corner controls,
 * set it in black on white, and keep the quick start to its own first page.
 */

import { useEffect, useMemo } from "react";
import type { ReactElement } from "react";
import { navigate } from "../router";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { parseGuide, type Block, type Inline } from "./markdown";
import source from "./guide.md?raw";
import "./GuideScreen.css";
import { PrivacyFooter } from "../ui/PrivacyFooter";

/** Where the pictures are served from (packages/client/public/guide-pictures). */
export const PICTURES = "/guide-pictures";

function Text({ runs }: { runs: Inline[] }): ReactElement {
  return (
    <>
      {runs.map((run, i) => (run.bold ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>))}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }): ReactElement {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p className="guide__p" key={i}>
                <Text runs={block.text} />
              </p>
            );
          case "subheading":
            return (
              <h3 className="guide__h3" key={i}>
                {block.text}
              </h3>
            );
          case "picture":
            return (
              <figure className="guide__figure" key={i}>
                <img className="guide__picture" src={`${PICTURES}/${block.name}`} alt={block.alt} loading="lazy" />
              </figure>
            );
          case "list": {
            const items = block.items.map((item, j) => (
              <li key={j}>
                <Text runs={item} />
              </li>
            ));
            return block.ordered ? (
              <ol className="guide__list" key={i}>
                {items}
              </ol>
            ) : (
              <ul className="guide__list" key={i}>
                {items}
              </ul>
            );
          }
        }
      })}
    </>
  );
}

export function GuideScreen(): ReactElement {
  const guide = useMemo(() => parseGuide(source), []);

  useEffect(() => {
    const before = document.title;
    document.title = `${guide.title} | Kids & Dragons`;
    return () => {
      document.title = before;
    };
  }, [guide.title]);

  return (
    <main className="guide" aria-labelledby="guide-title">
      <article className="guide__page">
        <div className="guide__actions">
          <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate({ name: "home" })}>
            Back to the start
          </Button>
          <Button variant="secondary" icon={<Icon name="scroll" />} onClick={() => window.print()}>
            Print this guide
          </Button>
        </div>

        <h1 className="guide__title" id="guide-title">
          {guide.title}
        </h1>
        <Blocks blocks={guide.intro} />

        <nav className="guide__contents" aria-label="In this guide">
          <ol className="guide__list">
            {guide.sections.map((section) => (
              <li key={section.id}>
                <a className="guide__link kad-focusable" href={`#${section.id}`}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {guide.sections.map((section, i) => (
          <section
            className={`guide__section${i === 0 ? " guide__section--first" : ""}`}
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
          >
            <h2 className="guide__h2" id={`${section.id}-title`}>
              {section.title}
            </h2>
            <Blocks blocks={section.blocks} />
          </section>
        ))}

        <div className="guide__actions">
          <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate({ name: "home" })}>
            Back to the start
          </Button>
        </div>
        <PrivacyFooter guide={false} />
      </article>
    </main>
  );
}

export default GuideScreen;
