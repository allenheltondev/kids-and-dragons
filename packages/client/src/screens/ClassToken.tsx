/**
 * ClassToken — the gear a class's power is in (#314, docs/class-mastery.md §4).
 *
 * A thorn bracer, a dusk hood, a star circlet, a song bell on a cord: one is
 * worn, and the ones taken off ride in the pack without a slot. Each rank is a
 * notch cut into the token, and the next rank's deed fills a row of pips.
 *
 * Dedicated paintings show each class's gear on the phone. Sworn class
 * figures remain separate art assets. Notches and pips stay distinct by
 * shape: a cut notch is a filled diamond and one still to come is a short dash; a pip done is a
 * filled dot and one to go is an empty ring. On screen the token is always its
 * own name ("your thorn bracer"), never "class token".
 */

import type { ReactElement } from "react";
import { CLASS_TOKENS, TOKEN_NOTCHES, deedTrack, notchesFor, rankTitle } from "@kad/shared";
import type { ClassDef, ClassId, ClassRank, DeedStep, ResolvedCharacter, RulesContent } from "@kad/shared";
import { helpAttrs } from "../help/longpress";
import { Icon } from "./icons";
import "./ClassToken.css";

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
  return <Icon name={`token_${classId}`} className="token-glyph" size={size} />;
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
          {i < cut ? <path d="M5 0.8 9.2 5 5 9.2 0.8 5Z" /> : <path d="M2.5 5.5h5" />}
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
      <div className="token-card__head">
        <ClassToken classId={character.class} rank={character.rank} owner={isMe ? "your" : `${character.name}'s`} />
        <span className="token-card__words">
          {named ? <span className="token-card__name">{isMe ? `Your ${name}` : `${character.name}'s ${name}`}</span> : null}
          {title === null ? null : <span className="token-card__title">{title}</span>}
          <span className="token-card__notches kad-muted">{notchWords(character.rank)}</span>
        </span>
      </div>
      {track === null ? (
        classDef && character.rank === "master" ? (
          <p className="token-card__next kad-muted">Every notch is cut!</p>
        ) : null
      ) : (
        <div className="token-card__next">
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
        </div>
      )}
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
        <span>{isMe ? "Your old gear" : "Their old gear"}</span>
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
