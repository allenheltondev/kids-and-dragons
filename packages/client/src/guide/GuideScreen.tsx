/**
 * GuideScreen (`/guide`, #257): how to run a session, for a grown-up who has
 * never seen the game. Its other half, `/guide/setup`, is the errands that need
 * a grown-up (accounts, a shared tablet, visitors, groups, deleting); nobody
 * needs it to play, so it is a page of its own that the first one points to.
 *
 * The words are `guide.md` and `setup.md` beside this file, the one source for the screen,
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

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactElement } from "react";
import { navigate, type Route } from "../router";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { parseGuide, type Block, type Inline, type Section } from "./markdown";
import source from "./guide.md?raw";
import setupSource from "./setup.md?raw";
import bannerPlay from "../assets/guide/guide-banner-play.webp";
import bannerSetup from "../assets/guide/guide-banner-setup.webp";
import emblemKeeping from "../assets/guide/guide-part-keeping.webp";
import emblemGroups from "../assets/guide/guide-part-groups.webp";
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

/** What a picture is of, from its shape: a phone's tall screen, a TV's wide one, or a part of a screen. */
type Shape = "phone" | "screen" | "panel";

function shapeOf(width: number, height: number): Shape {
  if (width === 0 || height === 0) return "panel";
  if (height / width >= 1.6) return "phone";
  if (width / height >= 1.5) return "screen";
  return "panel";
}

/** A picture, framed as the device it was taken on, and a tap opens it large enough to read. */
function Picture({ block }: { block: Extract<Block, { kind: "picture" }> }): ReactElement {
  const [shape, setShape] = useState<Shape>("panel");
  const [large, setLarge] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const src = `${PICTURES}/${block.name}`;

  return (
    <figure className={`guide__figure guide__figure--${shape}`}>
      <button
        type="button"
        ref={opener}
        className="guide__zoom kad-focusable"
        aria-label={`Enlarge the picture: ${block.alt}`}
        aria-haspopup="dialog"
        onClick={() => { setLarge(true); }}
      >
        <img
          className="guide__picture"
          src={src}
          alt={block.alt}
          loading="lazy"
          onLoad={(event) => { setShape(shapeOf(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)); }}
        />
      </button>
      <figcaption className="guide__caption" aria-hidden="true">
        {block.alt}
      </figcaption>
      {large ? <Enlarged src={src} alt={block.alt} onClose={() => { setLarge(false); opener.current?.focus(); }} /> : null}
    </figure>
  );
}

/** One picture over the page. Escape, a tap anywhere or the button closes it. */
function Enlarged({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }): ReactElement {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return createPortal(
    <div className="guide-large" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <img className="guide-large__picture" src={src} alt={alt} />
      <button ref={close} type="button" className="guide-large__close kad-focusable" aria-label="Close the picture">
        <Icon name="close" />
      </button>
    </div>,
    document.body,
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

/** The painted emblem that opens a part of the setup page. A part with none is just its name. */
const EMBLEMS: Record<string, string> = {
  "Keeping heroes": emblemKeeping,
  "Groups, visitors and privacy": emblemGroups,
};

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
      {partStart && section.part !== null ? (
        <p className="guide__part">
          {EMBLEMS[section.part] !== undefined ? (
            <img className="guide__emblem" src={EMBLEMS[section.part]} alt="" width={256} height={256} decoding="async" />
          ) : null}
          {section.part}
        </p>
      ) : null}
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

type Page = "play" | "setup";

/** The two pages of the guide: where each lives, what it is called and what it is for. */
const PAGES: Record<Page, { route: Route; href: string; label: string; blurb: string; banner: string }> = {
  play: {
    route: { name: "guide" },
    href: "/guide",
    label: "Running a game",
    blurb: "Hosting, seating the kids and playing tonight.",
    banner: bannerPlay,
  },
  setup: {
    route: { name: "guideSetup" },
    href: "/guide/setup",
    label: "Accounts, devices and groups",
    blurb: "Keeping heroes, a shared tablet, visitors, groups and deleting.",
    banner: bannerSetup,
  },
};

/** A link between the guide's pages: a plain link that opens in place, so it also works to open in a new tab. */
function PageLink({ page, className, current, children }: { page: Page; className: string; current?: boolean; children: React.ReactNode }): ReactElement {
  const { href, route } = PAGES[page];
  return (
    <a
      className={`${className} kad-focusable`}
      href={href}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(route);
      }}
    >
      {children}
    </a>
  );
}

function GuideDocument({ page, markdown }: { page: Page; markdown: string }): ReactElement {
  const guide = useMemo(() => parseGuide(markdown), [markdown]);
  const contents = useRef<HTMLDetailsElement>(null);
  const other: Page = page === "play" ? "setup" : "play";

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
  // One part is no grouping at all: its name would only repeat the page's.
  const grouped = parts.length > 1;

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

        <nav className="guide__pages" aria-label="Guide pages">
          {(["play", "setup"] as const).map((id) => (
            <PageLink key={id} page={id} current={id === page} className={`guide__page-tab${id === page ? " guide__page-tab--on" : ""}`}>
              <span className="guide__page-label">{PAGES[id].label}</span>
              <span className="guide__page-blurb">{PAGES[id].blurb}</span>
            </PageLink>
          ))}
        </nav>

        <header className="guide__hero">
          {/* Decorative: the page says everything it means in words. On a phone it is a strip above the text. */}
          <img className="guide__banner" src={PAGES[page].banner} alt="" width={1920} height={480} decoding="async" />
          <div className="guide__hero-words">
            <h1 className="guide__title" id="guide-title">
              {guide.title}
            </h1>
            <Blocks blocks={guide.intro} />
          </div>
        </header>

        <div className="guide__layout">
          <nav className="guide__contents" aria-label="In this guide">
            <details ref={contents}>
              <summary className="guide__contents-toggle kad-focusable">In this guide</summary>
              {parts.map((part, p) => (
                <Fragment key={part.name ?? p}>
                  {grouped && part.name !== null ? <p className="guide__contents-part">{part.name}</p> : null}
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
                first={page === "play" && i === 0}
                partStart={grouped && (i === 0 || guide.sections[i - 1]?.part !== section.part)}
              />
            ))}
            <PageLink page={other} className="guide__next">
              <span className="guide__next-kicker">{page === "play" ? "Next" : "Back to"}</span>
              <span className="guide__next-label">{PAGES[other].label}</span>
              <span className="guide__next-blurb">{PAGES[other].blurb}</span>
            </PageLink>
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

export function GuideScreen(): ReactElement {
  return <GuideDocument page="play" markdown={source} />;
}

export function SetupGuideScreen(): ReactElement {
  return <GuideDocument page="setup" markdown={setupSource} />;
}

export default GuideScreen;
