/**
 * ClassToken — the gear a class's power is in (#314, docs/class-mastery.md §4).
 *
 * A thorn bracer, a dusk hood, a star circlet, a song bell on a cord: one is
 * worn, and the ones taken off ride in the pack without a slot. Each rank is a
 * notch cut into the token, and the next rank's deed fills a row of pips.
 *
 * Simple SVG, no raster art: below Sworn the token is an icon on the phone
 * (docs/class-mastery.md §4), and a finished Sworn class figure is a separate art
 * asset. Notches and pips are shapes, never colour alone (spec §11): a notch cut
 * is a filled chevron and one still to come is a short dash; a pip done is a
 * filled dot and one to go is an empty ring. On screen the token is always its
 * own name ("your thorn bracer"), never "class token".
 */

import type { ReactElement } from "react";
import { CLASS_TOKENS, TOKEN_NOTCHES, deedTrack, notchesFor, rankTitle } from "@kad/shared";
import type { ClassDef, ClassId, ClassRank, DeedStep, ResolvedCharacter, RulesContent } from "@kad/shared";
import { helpAttrs } from "../help/longpress";
import "./ClassToken.css";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* eslint-disable react/jsx-key -- static glyph table, never mapped */
const GLYPHS: Record<ClassId, ReactElement> = {
  // A cuff with thorns along its top edge.
  thornguard: (
    <g {...S}>
      <rect x="4" y="10" width="16" height="9" rx="3" />
      <path d="M6 10l1.5-4 1.5 4M10.5 10l1.5-5 1.5 5M15 10l1.5-4 1.5 4" />
      <path d="M8 14.5h8" />
    </g>
  ),
  // A hood, its face a dark opening.
  duskrunner: (
    <g {...S}>
      <path d="M12 3c-5 0-8 4.5-8 10v6.5c2.5 1 5.2 1.5 8 1.5s5.5-.5 8-1.5V13c0-5.5-3-10-8-10Z" />
      <path d="M8 18c0-4 1.8-8 4-8s4 4 4 8" fill="currentColor" fillOpacity="0.45" />
    </g>
  ),
  // A thin circlet with a star at its front.
  starweaver: (
    <g {...S}>
      <path d="M3 15c2.5 3 5.5 4.5 9 4.5s6.5-1.5 9-4.5" />
      <path d="M12 4l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4Z" fill="currentColor" fillOpacity="0.35" />
    </g>
  ),
  // A bell hung on a looped cord.
  songkeeper: (
    <g {...S}>
      <path d="M9 3.5c1 1.5 5 1.5 6 0" />
      <path d="M12 5v2.5" />
      <path d="M7 17c1-1.2 1-3.5 1-5.5a4 4 0 0 1 8 0c0 2 0 4.3 1 5.5Z" />
      <path d="M6 17h12" />
      <circle cx="12" cy="19.5" r="1.3" fill="currentColor" />
    </g>
  ),
};
/* eslint-enable react/jsx-key */

/** The token's own name: "thorn bracer". */
export function tokenName(classId: ClassId): string {
  return CLASS_TOKENS[classId]?.name ?? classId;
}

/** "2 notches" — said, so the shapes are never the only way to know. */
export function notchWords(rank: ClassRank | undefined): string {
  const n = notchesFor(rank);
  return n === 0 ? "no notches yet" : n === 1 ? "1 notch" : `${String(n)} notches`;
}

/** The token's picture, sized by the text around it. */
export function TokenGlyph({ classId, size = "1em" }: { classId: ClassId; size?: string }): ReactElement {
  return (
    <svg className="token-glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {GLYPHS[classId] ?? GLYPHS.thornguard}
    </svg>
  );
}

/**
 * The notches a rank has cut: three seats, always drawn, so a new one landing
 * never moves anything. `fresh` is the notch that just landed (1-based), which
 * the rank-up moment drops in.
 */
export function Notches({ rank, fresh }: { rank: ClassRank | undefined; fresh?: number }): ReactElement {
  const cut = notchesFor(rank);
  return (
    <span className="token-notches" aria-hidden="true">
      {Array.from({ length: TOKEN_NOTCHES }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 10 10"
          className={`token-notch${i < cut ? " token-notch--cut" : ""}${fresh === i + 1 ? " token-notch--fresh" : ""}`}
        >
          {i < cut ? <path d="M1 2h8L5 9Z" /> : <path d="M2.5 5.5h5" />}
        </svg>
      ))}
    </span>
  );
}

export interface ClassTokenProps {
  classId: ClassId;
  rank: ClassRank | undefined;
  /** `sm` rides in a line of text; `md` stands on its own; `lg` is the rank-up moment's. */
  size?: "sm" | "md" | "lg";
  /** Lit up: the moment a rank lands. */
  glow?: boolean;
  fresh?: number;
  /** Whose it is, for the words a screen reader hears ("Your thorn bracer"). */
  owner?: string;
  /** Pressing and holding says what a token is (#256). Off where the token is inside another help thing. */
  holdable?: boolean;
}

/** The token with its notches, one picture with one name. */
export function ClassToken({ classId, rank, size = "md", glow = false, fresh, owner, holdable = true }: ClassTokenProps): ReactElement {
  const name = tokenName(classId);
  const said = `${owner ? `${owner} ${name}` : name}, ${notchWords(rank)}`;
  return (
    <span
      className={`class-token class-token--${size} class-token--${classId}${glow ? " class-token--glow" : ""}`}
      role="img"
      aria-label={said}
      {...(holdable ? helpAttrs({ kind: "token", name: name.charAt(0).toUpperCase() + name.slice(1), icon: "star", text: `${said.charAt(0).toUpperCase()}${said.slice(1)}.` }) : {})}
    >
      <span className="class-token__face">
        <TokenGlyph classId={classId} />
      </span>
      <Notches rank={rank} {...(fresh !== undefined ? { fresh } : {})} />
    </span>
  );
}

/** One deed's pips: a dot per time, or a bar with the count for a long one (a Songkeeper's hearts). */
export function DeedPips({ step }: { step: DeedStep }): ReactElement {
  const words = `${String(step.have)} of ${String(step.need)}`;
  return (
    <span className="deed-pips">
      {step.need <= 10 ? (
        <span className="deed-pips__row" aria-hidden="true">
          {Array.from({ length: step.need }, (_, i) => (
            <span key={i} className={`deed-pip${i < step.have ? " deed-pip--done" : ""}`} />
          ))}
        </span>
      ) : (
        <span className="deed-pips__bar" aria-hidden="true">
          <span className="deed-pips__fill" style={{ inlineSize: `${String((step.have / step.need) * 100)}%` }} />
        </span>
      )}
      <span className="deed-pips__count">{words}</span>
    </span>
  );
}

export interface TokenCardProps {
  character: ResolvedCharacter;
  isMe: boolean;
  rules: RulesContent | null;
  /** How many heroes are at the table, which picks the deed track when the two are level. */
  partySize: number;
  /** False where a heading above already names the token (the You page's fold). */
  named?: boolean;
}

/**
 * The worn token, its rank and the deed toward the next one: what a hero is
 * growing into, on their own phone and on anyone's sheet. Without the rules
 * (still loading, or a sheet opened between games before they land) the
 * token and its notches still show; only the pips wait.
 */
export function TokenCard({ character, isMe, rules, partySize, named = true }: TokenCardProps): ReactElement {
  const classDef = (rules?.classes as Partial<Record<ClassId, ClassDef>> | undefined)?.[character.class];
  // Without the rules the sheet's own class line still names the class.
  const title = classDef ? rankTitle(classDef, character.rank) : null;
  const track = classDef ? deedTrack(classDef, character.rank, character.deeds, partySize) : null;
  const name = tokenName(character.class);
  return (
    <div className="token-card">
      <ClassToken classId={character.class} rank={character.rank} owner={isMe ? "your" : `${character.name}'s`} />
      <span className="token-card__words">
        {named ? <span className="token-card__name">{isMe ? `Your ${name}` : `${character.name}'s ${name}`}</span> : null}
        {title === null ? null : <span className="token-card__title">{title}</span>}
        {track === null ? (
          classDef && character.rank === "master" ? (
            <span className="token-card__next kad-muted">Every notch is cut!</span>
          ) : null
        ) : (
          <span className="token-card__next">
            <span className="token-card__toward kad-muted">
              Next notch: {rankTitle(classDef!, track.next)}
            </span>
            <ul className="token-card__deeds">
              {track.steps.map((step) => (
                <li className="token-card__deed" key={step.deed}>
                  <span className="token-card__deed-label">{step.label}</span>
                  <DeedPips step={step} />
                </li>
              ))}
            </ul>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The tokens taken off, in the pack with their notches: kept, but only the
 * worn one counts. They take no slot (docs/class-mastery.md §4), so they sit
 * beside the six, like the story things.
 */
export function SpareTokens({ spares, isMe }: { spares: ResolvedCharacter["spares"]; isMe: boolean }): ReactElement | null {
  if (!spares || spares.length === 0) return null;
  return (
    <div className="spare-tokens">
      <h4 className="spare-tokens__heading">
        <TokenGlyph classId={spares[0]!.class} />
        <span>{isMe ? "Your old gear (it never takes a slot)" : "Their old gear (it never takes a slot)"}</span>
      </h4>
      <ul className="spare-tokens__list">
        {spares.map((spare) => (
          <li className="spare-tokens__item kad-chip" key={spare.class}>
            <ClassToken classId={spare.class} rank={spare.rank} size="sm" />
            <span className="spare-tokens__name">{tokenName(spare.class)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
