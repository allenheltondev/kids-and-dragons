/**
 * LobbyContent — WorldView while `phase === "lobby"`.
 *
 * spec §2.1: the shared screen shows the room code when idle. So the code is
 * the biggest thing on it, with a QR beside it (architecture §4.5 step 2 —
 * scan and you are already you, no "who are you?" step).
 *
 * Sized entirely in `em` against `.kad-surface`, whose own font-size comes from
 * its container width: this renders full-screen on a TV and in the ~60%
 * portrait pane of Travel Mode, and never knows which (architecture §4.6).
 */

import { HeroName } from "./HeroName";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { setLobbyInsetBottom, setLobbyInsetTop } from "../world/stage-inset";
import { lobbyCampaign, type PartyMember } from "@kad/shared";
import { useGameStore, useParty, useRunState } from "../store";
import { CampaignArt } from "./CampaignArt";
import { campaignOptionLine, campaignPremise, journeyLine, lockedLine, nextChapterLine } from "./campaign-copy";
import { Spinner } from "../ui/Spinner";
import { CharacterPortrait } from "./CharacterPortrait";
import { ClassToken } from "./ClassToken";
import { Icon } from "./icons";
import { savedHeading, savedHeroes, savedWhere } from "./save-copy";
import { crewChoices } from "./crew-copy";
import { RoomCodeLetter } from "./RoomCodeLetter";
import { CrewIdentity } from "./CrewIdentity";
import { VoteTicks } from "./VoteTicks";
import { useHelp } from "../help/content";
import { joinUrl } from "../ui/share-invite";
import "./shared.css";
import "./LobbyContent.css";
import "./TvLobby.css";
import { RiftSightings } from "./RiftSight";
import { lobbyReadiness, readyLine } from "./lobby-readiness";

/**
 * The QR is a convenience, never a requirement — the code is always readable
 * next to it. If generation fails we simply do not draw one.
 */
function useJoinQr(code: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (code === null || code === "") {
      setDataUrl(null);
      return;
    }
    let live = true;
    // Loaded on demand: the QR encoder is a lobby-only nicety, and pulling it
    // out of the main chunk keeps it off the join screen's critical path. If
    // the import itself fails, that is just "no QR" like any other failure.
    void import("qrcode")
      .then(({ toDataURL }) =>
        toDataURL(joinUrl(code), {
          margin: 1,
          width: 512,
          errorCorrectionLevel: "M",
          color: { dark: "#12102a", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (live) setDataUrl(url);
      })
      .catch(() => {
        if (live) setDataUrl(null);
      });
    return () => {
      live = false;
    };
  }, [code]);
  return dataUrl;
}

/**
 * Where the camp's window is: how much of the bottom of the pane the lobby's
 * panels cover (from the bottom of the window to the bottom of the lobby) and
 * how far down its header reaches (from the top of the lobby to the top of the
 * window), told to the stage (stage-inset.ts `setLobbyInsetBottom`,
 * `setLobbyInsetTop`) the way the narration plate tells it its height. The
 * window is a flex spacer, so anything around it growing or shrinking resizes
 * it, and one observer on it and the lobby sees every change.
 */
export function useLobbyInset(
  section: RefObject<HTMLElement | null>,
  gapRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const lobby = section.current;
    const gap = gapRef.current;
    if (!lobby || !gap) return;
    const report = (): void => {
      const outer = lobby.getBoundingClientRect();
      const inner = gap.getBoundingClientRect();
      setLobbyInsetTop(inner.top - outer.top);
      setLobbyInsetBottom(outer.bottom - inner.bottom);
    };
    const clear = (): void => {
      setLobbyInsetBottom(0);
      setLobbyInsetTop(0);
    };
    report();
    if (typeof ResizeObserver === "undefined") return clear;
    const observer = new ResizeObserver(report);
    observer.observe(lobby);
    observer.observe(gap);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [section, gapRef]);
}

function MemberCard({ member, arriving = false }: { member: PartyMember; arriving?: boolean }): ReactElement {
  const { character } = member;
  return (
    <li className={`lobby-member${member.ready ? " lobby-member--ready" : ""}${arriving ? " lobby-member--arriving" : ""}`}>
      {/* The lineup is the one place everyone looks while the room fills up, so
          it is their actual character, at their actual tier — a party of three
          fledglings and a returning Radiant should look like that. */}
      <span className="lobby-member__seat">
        <span className="lobby-member__portrait" aria-hidden="true">
          <CharacterPortrait
            backdrop
            hero={character}
            accent={character.appearance.accent}
            className="lobby-member__art"
            lit={member.ready}
          />
        </span>
        {/* Pinned to the portrait rather than added to the card: a phone
            dropping used to give its card an extra row, and the whole lineup
            grew and shifted under everybody else's. */}
        {member.connected ? null : (
          <span className="kad-chip kad-chip--warn lobby-member__away">
            <Icon name="close" />
            <span>Away</span>
          </span>
        )}
      </span>
      <span className="lobby-member__text">
        <span className="lobby-member__name"><HeroName name={character.name} look={character.look} /></span>
        {/* The worn token and its notches (#314), in place of the bare class
            icon: same seat, so a rank landing never grows the card. */}
        <span className="lobby-member__meta kad-muted">
          <ClassToken classId={character.class} rank={character.rank} size="sm" owner={`${character.name}'s`} holdable={false} />
          <span>Level {character.level}</span>
        </span>
      </span>
      {/* Icon + word: readiness never reads as colour alone (spec §11).
          Both chips are always here, stacked in one cell, and readying up only
          swaps which is visible: the cell is as wide as the wider word either
          way, so a tap on somebody's phone cannot reflow the card. */}
      <span className="lobby-member__status">
        <span aria-hidden={!member.ready || !member.connected} className={`kad-chip kad-chip--ok${member.ready && member.connected ? "" : " lobby-member__chip--off"}`}>
          <Icon name="ready" />
          <span>Ready</span>
        </span>
        <span aria-hidden={member.ready || !member.connected} className={`kad-chip${member.ready || !member.connected ? " lobby-member__chip--off" : ""}`}>
          <Icon name="waiting" />
          <span className="lobby-member__pending-help">Tap Ready on your phone</span>
          <span className="lobby-member__pending-short">Not ready</span>
        </span>
      </span>
    </li>
  );
}

export function LobbyContent(): ReactElement {
  const state = useRunState();
  const party = useParty();
  const sessionCode = useGameStore((s) => s.session?.roomCode ?? null);
  const host = useGameStore((s) => s.session?.host === true);

  // A room open to visitors (#249) shows its longer code, which anybody can
  // join with: a phone from another household needs it, and one from the
  // room's own takes it as well as the short one.
  const visiting = state?.visitorCode !== undefined;
  const code = state?.visitorCode ?? state?.roomCode ?? sessionCode;
  const qr = useJoinQr(code);
  const help = useHelp();

  const sectionRef = useRef<HTMLElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  useLobbyInset(sectionRef, windowRef);

  const readiness = lobbyReadiness(state ?? { party, seats: undefined, removed: undefined });
  const previousMembers = useRef<Set<string> | null>(null);
  useEffect(() => {
    previousMembers.current = new Set(readiness.members.map(member => member.playerId));
  }, [party, state?.removed]);
  const readyCount = readiness.ready;
  // A graph campaign (#195) has a stop, not a numbered chapter: the journey's
  // line when it has a journey, else the chapter line exactly as before. The
  // phones hold the choosing; the table just sees where the party stands.
  const upNext = journeyLine(state?.campaign) ?? nextChapterLine(state?.campaign);
  // A campaign the household has not unlocked (#221) says why instead.
  const locked = lockedLine(state?.campaign);
  const choice = state ? lobbyCampaign(state) : null;
  const cards = (state?.campaignOptions?.length ?? 0) > 1;
  const startReady = readiness.allReady && locked === null;

  return (
    <section className="lobby entry-scene-host" aria-label="Lobby" ref={sectionRef}>
      {/* No painted backdrop of its own: the crew's camp is drawn behind the
          lobby (world/lobby-camp-stage.ts, docs/camp.md §3), and on a screen
          with no WebGL the still board draws it instead (StaticStage). */}
      <header className="lobby__header">
      {/* The household's table, when the family named it: where the game is
          kept, not the phones. */}
      {state?.location?.trim() ? <p className="lobby__place kad-muted"><span>{state.location.trim()}</span></p> : null}
      {state ? (
        <div className="lobby__crew">
          <CrewIdentity name={crewChoices(state).current} compact />
          {/* The shared screen is read, not driven (docs/tv-read-only-audit.md):
              the crews are in the Room panel, and this says where. */}
          {host ? <span className="lobby__crew-hint kad-muted">Change crew in Room</span> : null}
        </div>
      ) : null}
      </header>
      {/* The camp's window (#614): the space between the header and the
          panels, which this takes up so they stand along the bottom of the
          pane. What lies below it is what the lobby covers, reported to the
          stage so every hero stands above the words. */}
      <div className="lobby__camp-window" ref={windowRef} aria-hidden="true" />
      {state?.crewSetup ? (
        <p className="lobby__place" role="status">
          Make new heroes on your phones. Your other crew&rsquo;s adventure is saved.
        </p>
      ) : null}
      {/* Heroes new to the adventure this crew is partway through: nothing
          resumes until the grown-up running the game picks (crew.ts,
          `checkNewcomers`), so nobody lands in the middle of somebody else's
          story by accident. Said here; picked in the Room panel, since the
          shared screen has nothing to click (docs/tv-read-only-audit.md). */}
      {state?.crewCheck ? (
        <div className="lobby__premise lobby__crew-check" role="group" aria-label="Keep going or start fresh?">
          <p className="lobby__premise-title">
            <Icon name="crew" />
            <span>New heroes, or the same crew?</span>
          </p>
          <p className="lobby__premise-text">
            {crewChoices(state).current} is partway through {state.crewCheck.title}. None of these heroes have been
            on it yet.
            {host ? " Tap Room to keep going or start a new crew." : " The grown-up running the game picks."}
          </p>
        </div>
      ) : null}
      {/* A chapter this household stopped partway (#259): said to the room, and
          taken up from any phone. */}
      {state?.saved ? (
        <div className="lobby__premise">
          <p className="lobby__premise-title">
            <Icon name="scroll" />
            <span>{savedHeading(state.saved)}</span>
          </p>
          <p className="lobby__premise-text">
            {savedWhere(state.saved)} {state.saved.recap} {savedHeroes(state.saved)} can tap Keep going on a phone.
          </p>
        </div>
      ) : null}
      {/* Before chapter 1 the table needs to know what it is setting out on —
          otherwise the first scene is the first anyone hears of the story.
          Told while the room is filling, and gone once the lineup starts:
          from then on the party is what the screen is for, and a full
          three-person lineup has to fit a 720p TV without scrolling.
          Not beside the adventure cards either: they name the choice, the
          phones carry each one's premise, and the two together push the
          room code off a 720p TV. */}
      {party.length === 0 && !cards && campaignPremise(state?.campaign) !== null ? (
        <div className="lobby__premise">
          <p className="lobby__premise-title">
            <Icon name="scroll" />
            <span>{state?.campaign?.title}</span>
          </p>
          <p className="lobby__premise-text">{campaignPremise(state?.campaign)}</p>
        </div>
      ) : null}
      {/* More than one adventure on offer: a card each, with its painting, so
          the table sees what it could play and what is still to come (a
          locked sequel, asleep with its reason). The phones vote when two or
          more could start; one that could is simply what's next. Cards sit in
          a row, so they still fit beside a full party. */}
      {state && cards ? (
        <ul className="lobby__campaigns" aria-label="Which adventure?">
          {(state.campaignOptions ?? []).map((option) => {
            const votedIds = party
              .filter((member) => state.campaignVotes?.[member.playerId] === option.id)
              .map((member) => member.playerId);
            const picked = option.locked === undefined && option.id === choice?.leader?.id;
            return (
              <li
                className={`lobby__campaign${picked ? " lobby__campaign--picked" : ""}`}
                data-locked={option.locked !== undefined}
                aria-label={`${option.title}${picked ? ", selected" : ""}`}
                key={option.id}
              >
                <CampaignArt campaignId={option.id} />
                <span className="lobby__campaign-title">
                  <Icon name={option.locked ? "close" : picked ? "vote" : "map"} />
                  <span>{option.title}</span>
                  {picked ? <span className="lobby__campaign-selected"><Icon name="ready" />Selected</span> : null}
                </span>
                <span className="lobby__campaign-line">{campaignOptionLine(option)}</span>
                {choice?.contested && option.locked === undefined ? (
                  <VoteTicks
                    voterIds={party.map((member) => member.playerId)}
                    votedIds={votedIds}
                    party={party}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : locked !== null ? (
        <p className="lobby__next-chapter">
          <Icon name="close" />
          <span>
            {state?.campaign?.title}: {locked}
          </span>
        </p>
      ) : upNext !== null ? (
        <p className="lobby__next-chapter">
          <Icon name="map" />
          <span>{upNext}</span>
        </p>
      ) : null}
      {/* The rifts where the party stands (#229): a shimmer for the room,
          Riftlight on a Starweaver's own phone. Nothing without a rift. */}
      <RiftSightings />

      {/* The code is the biggest thing on an idle screen (spec §2.1), but the
          moment somebody is actually in the room the party matters more — and
          in Travel Mode the whole lobby has to fit a phone.
          Once anyone has joined, the code and QR step down to a strip so a
          full three-person party is on screen without scrolling. */}
      <div className="lobby__gather">
        <div className={`lobby__join${party.length > 0 ? " lobby__join--compact" : ""}`}>
          <div className="lobby__code-block">
            <p className="lobby__code-label kad-label">{visiting ? "Room code (visitors welcome)" : "Room code"}</p>
            <p className="lobby__code" aria-label={code === null ? "No room code yet" : `Room code ${code.split("").join(" ")}`}>
              {code === null
                ? "----"
                : code.split("").map((letter, i) => (
                    // Position is meaningful and letters repeat, so index is the key.
                    <RoomCodeLetter key={`${letter}-${String(i)}`} letter={letter} />
                  ))}
            </p>
          </div>

          <div className="lobby__qr-block">
            {qr === null ? (
              <div className="lobby__qr lobby__qr--empty">
                <Icon name="qr" size="3em" />
              </div>
            ) : (
              <img className="lobby__qr" src={qr} alt={`QR code to join room ${code ?? ""}`} />
            )}
          </div>
          {/* How to get in, in one line with a picture (#256). Its words are content (help.json) and
              never count the letters, because a visitor room's code is longer than a family room's. */}
          {help !== null ? (
            <p className="lobby__join-step">
              <Icon name={help.join.icon} size="2em" />
              <span>{help.join.text}</span>
            </p>
          ) : null}
        </div>

        <div className="lobby__party">
          {/* When everyone is ready the heading says so, in its own place: a line of its own
              under it moved the cards, and shrank the camp's window, when the last hero tapped
              Ready. The words are said in a status region that is always here (empty while
              anyone is getting ready), so a screen reader hears them the moment they appear. */}
          <h3 className={`lobby__party-heading${startReady ? " lobby__party-heading--ready" : ""}`}>
            <Icon name={startReady ? "ready" : "party"} />
            <span>
              {startReady ? null : <span>The party ({readyCount}/{readiness.total} ready)</span>}
              <span role="status">{startReady ? readyLine(state?.saved !== undefined) : null}</span>
            </span>
          </h3>
          {readiness.members.length === 0 && readiness.making.length === 0 ? (
            /* A div, not a p — Spinner renders a block, which is invalid inside
               a <p> and warns at runtime. */
            <div className="lobby__waiting kad-row" role="status">
              <Spinner />
              <span>Waiting for the first player…</span>
            </div>
          ) : (
            <ul className="lobby__lineup">
              {readiness.members.map((member) => (
                <MemberCard key={member.playerId} member={member} arriving={previousMembers.current !== null && !previousMembers.current.has(member.playerId)} />
              ))}
              {readiness.making.map(player => (
                <li className="lobby-member lobby-member--making" key={player.id}>
                  <span className="lobby-member__portrait" aria-hidden="true"><Icon name="palette" size="2em" /></span>
                  <span className="lobby-member__text">
                    <span className="lobby-member__name">{player.name}</span>
                    <span className="kad-chip"><Icon name="waiting" /><span>Making a hero</span></span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
