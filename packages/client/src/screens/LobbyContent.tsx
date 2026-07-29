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

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { toDataURL } from "qrcode";
import type { PartyMember } from "@kad/shared";
import { useGameStore, useParty, useRunState } from "../store";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import "./shared.css";
import "./LobbyContent.css";

/** Where a scanning phone lands (architecture §4.6 routes). */
function joinUrl(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/p/${code}`;
}

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
    void toDataURL(joinUrl(code), {
      margin: 1,
      width: 512,
      errorCorrectionLevel: "M",
      color: { dark: "#12102a", light: "#ffffff" },
    })
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

function MemberCard({ member }: { member: PartyMember }): ReactElement {
  const { character } = member;
  return (
    <li className={`lobby-member${member.ready ? " lobby-member--ready" : ""}`}>
      <span className="lobby-member__portrait" aria-hidden="true">
        <Icon name={character.species} size="2.4em" />
      </span>
      <span className="lobby-member__text">
        <span className="lobby-member__name">{character.name}</span>
        <span className="lobby-member__meta kad-muted">
          <Icon name={character.class} />
          <span>Level {character.level}</span>
        </span>
      </span>
      <span className="lobby-member__status">
        {/* Icon + word: readiness never reads as colour alone (spec §11). */}
        {member.ready ? (
          <span className="kad-chip kad-chip--ok">
            <Icon name="ready" />
            <span>Ready</span>
          </span>
        ) : (
          <span className="kad-chip">
            <Icon name="waiting" />
            <span>Getting ready</span>
          </span>
        )}
        {member.connected ? null : (
          <span className="kad-chip kad-chip--warn">
            <Icon name="close" />
            <span>Away</span>
          </span>
        )}
      </span>
    </li>
  );
}

export function LobbyContent(): ReactElement {
  const state = useRunState();
  const party = useParty();
  const sessionCode = useGameStore((s) => s.session?.roomCode ?? null);
  const code = state?.roomCode ?? sessionCode;
  const qr = useJoinQr(code);

  const readyCount = party.filter((m) => m.ready).length;

  return (
    <section className="lobby" aria-labelledby="lobby-heading">
      <h2 className="lobby__heading" id="lobby-heading">
        <Icon name="party" />
        <span>Everyone in?</span>
      </h2>

      {/* The code is the biggest thing on an idle screen (spec §2.1), but the
          moment somebody is actually in the room the party matters more — and
          in Travel Mode the whole lobby has to fit a phone.
          Once anyone has joined, the code and QR step down to a strip so a
          full three-person party is on screen without scrolling. */}
      <div className={`lobby__join${party.length > 0 ? " lobby__join--compact" : ""}`}>
        <div className="lobby__code-block">
          <p className="lobby__code-label kad-muted">Room code</p>
          <p className="lobby__code" aria-label={code === null ? "No room code yet" : `Room code ${code.split("").join(" ")}`}>
            {code === null
              ? "----"
              : code.split("").map((letter, i) => (
                  // Position is meaningful and letters repeat, so index is the key.
                  <span className="lobby__code-letter" key={`${letter}-${String(i)}`} aria-hidden="true">
                    {letter}
                  </span>
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
          <p className="lobby__qr-hint kad-muted">
            <Icon name="travel" />
            <span>Scan to join</span>
          </p>
        </div>
      </div>

      <div className="lobby__party">
        <h3 className="lobby__party-heading">
          <Icon name="party" />
          <span>
            The party ({readyCount}/{party.length} ready)
          </span>
        </h3>
        {party.length === 0 ? (
          /* A div, not a p — Spinner renders a block, which is invalid inside
             a <p> and warns at runtime. */
          <div className="lobby__waiting kad-row" role="status">
            <Spinner />
            <span>Waiting for the first player…</span>
          </div>
        ) : (
          <ul className="lobby__lineup">
            {party.map((member) => (
              <MemberCard key={member.playerId} member={member} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
