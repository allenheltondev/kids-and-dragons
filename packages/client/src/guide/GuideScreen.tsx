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
 * The page is laid out as a manual, not a scroll of text: the sections are
 * grouped into parts under a contents list (a sidebar on a wide screen, a
 * fold-away list on a phone), each section is a card with its steps, its
 * "**Label**: what it does" lists and its notes drawn as their own things,
 * and its pictures sit together beside the words instead of between them.
 *
 * The same page is the printable one. "Print this guide" opens the browser's
 * print dialog, and the print styles drop the buttons and the corner controls,
 * set it in black on white, and keep the quick start to its own first page.
 */

import { Fragment, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { navigate } from "../router";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { parseGuide, type Block, type Inline, type Section } from "./markdown";
import source from "./guide.md?raw";
import "./GuideScreen.css";
import { PrivacyFooter } from "../ui/PrivacyFooter";

/** Where the pictures are served from (packages/client/public/guide-pictures). */
export const PICTURES = "/guide-pictures";

/** A bullet that reads "**Label**: what it does", split so the labels can line up in a column. */
function term(item: Inline[]): { label: string; rest: Inline[] } | null {
  const [first, second, ...others] = item;
  if (!first?.bold || second === undefined || second.bold || !second.text.startsWith(": ")) return null;
  return { label: first.text, rest: [{ text: second.text.slice(2), bold: false }, ...others] };
}

function Text({ runs }: { runs: Inline[] }): ReactElement {
  return (
    <>
      {runs.map((run, i) => (run.bold ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>))}
    </>
  );
}

function Picture({ block }: { block: Extract<Block, { kind: "picture" }> }): ReactElement {
  return (
    <figure className="guide__figure">
      <img className="guide__picture" src={`${PICTURES}/${block.name}`} alt={block.alt} loading="lazy" />
      <figcaption className="guide__caption" aria-hidden="true">
        {block.alt}
      </figcaption>
    </figure>
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
          case "note":
            return (
              <aside className="guide__note" key={i}>
                <Text runs={block.text} />
              </aside>
            );
          case "subheading":
            return (
              <h3 className="guide__h3" key={i}>
                {block.text}
              </h3>
            );
          case "picture":
            return <Picture block={block} key={i} />;
          case "list": {
            if (block.ordered) {
              return (
                <ol className="guide__steps" key={i}>
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <div className="guide__step">
                        <p className="guide__step-text">
                          <Text runs={item} />
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              );
            }
            const terms = block.items.map(term);
            if (terms.every((entry) => entry !== null)) {
              return (
                <dl className="guide__terms" key={i}>
                  {terms.map((entry, j) => (
                    <div className="guide__term" key={j}>
                      <dt>{entry.label}</dt>
                      <dd>
                        <Text runs={entry.rest} />
                      </dd>
                    </div>
                  ))}
                </dl>
              );
            }
            return (
              <ul className="guide__bullets" key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Text runs={item} />
                  </li>
                ))}
              </ul>
            );
          }
        }
      })}
    </>
  );
}

/** A section's words, and beside them every picture it shows (so the pictures read as a set). */
function SectionCard({ section, number, first, partStart }: { section: Section; number: number; first: boolean; partStart: boolean }): ReactElement {
  const words = section.blocks.filter((block) => block.kind !== "picture");
  const pictures = section.blocks.filter((block) => block.kind === "picture");
  return (
    <section
      className={`guide__section${first ? " guide__section--first" : ""}`}
      id={section.id}
      aria-labelledby={`${section.id}-title`}
    >
      {partStart && section.part !== null ? <p className="guide__part">{section.part}</p> : null}
      <header className="guide__head">
        <span className="guide__number" aria-hidden="true">
          {number}
        </span>
        <h2 className="guide__h2" id={`${section.id}-title`}>
          {section.title}
        </h2>
      </header>
      <div className={`guide__split${pictures.length > 0 ? " guide__split--pictures" : ""}`}>
        <div className="guide__words">
          <Blocks blocks={words} />
        </div>
        {pictures.length > 0 ? (
          <div className="guide__pictures">
            <Blocks blocks={pictures} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function GuideScreen(): ReactElement {
  const guide = useMemo(() => parseGuide(source), []);
  const contents = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const before = document.title;
    document.title = `${guide.title} | Kids & Dragons`;
    return () => {
      document.title = before;
    };
  }, [guide.title]);

  // Beside the words on a wide screen the contents stay open; on a phone they fold away behind a button.
  useEffect(() => {
    const wide = window.matchMedia?.("(min-width: 62em)");
    const details = contents.current;
    if (!wide || !details) return undefined;
    const sync = (): void => {
      if (wide.matches) details.open = true;
    };
    sync();
    wide.addEventListener("change", sync);
    return () => {
      wide.removeEventListener("change", sync);
    };
  }, []);

  const parts = guide.sections.reduce<{ name: string | null; sections: { section: Section; number: number }[] }[]>(
    (all, section, i) => {
      const last = all.at(-1);
      if (last && last.name === section.part) last.sections.push({ section, number: i + 1 });
      else all.push({ name: section.part, sections: [{ section, number: i + 1 }] });
      return all;
    },
    [],
  );

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

        <header className="guide__hero">
          <h1 className="guide__title" id="guide-title">
            {guide.title}
          </h1>
          <Blocks blocks={guide.intro} />
        </header>

        <div className="guide__layout">
          <nav className="guide__contents" aria-label="In this guide">
            <details ref={contents}>
              <summary className="guide__contents-toggle kad-focusable">In this guide</summary>
              {parts.map((part, p) => (
                <Fragment key={part.name ?? p}>
                  {part.name !== null ? <p className="guide__contents-part">{part.name}</p> : null}
                  <ul className="guide__contents-list">
                    {part.sections.map(({ section }) => (
                      <li key={section.id}>
                        <a className="guide__link kad-focusable" href={`#${section.id}`}>
                          {section.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Fragment>
              ))}
            </details>
          </nav>

          <div className="guide__main">
            {guide.sections.map((section, i) => (
              <SectionCard
                key={section.id}
                section={section}
                number={i + 1}
                first={i === 0}
                partStart={i === 0 || guide.sections[i - 1]?.part !== section.part}
              />
            ))}
          </div>
        </div>

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
