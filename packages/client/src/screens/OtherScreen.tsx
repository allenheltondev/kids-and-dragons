/**
 * Another TV in another place: the two halves of one handoff
 * (handlers/screens.ts, architecture §4.5 "More than one screen").
 *
 * A family on the sofa and a child in a hospital bed play one game on two TVs.
 * It is still one room: phones at either place join it as they always do, with
 * the room's own code. What the second place needs is a screen.
 *
 * `AddScreen` is the leader's half, folded away in the Room panel: one tap
 * makes a code, shown big enough to read across a room, with a link to send
 * from a phone. `ShowHere` is the other TV's half, behind a quiet link in the
 * start screen's Host card, beside Party Mode's table name: type the code (or open the link) and this screen
 * shows the game. Neither is in anybody's way on an ordinary evening.
 *
 * Grown-up-facing copy, kept short: US spelling, no dashes for breath.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { ScreenCode } from "@kad/shared";
import { normalizePairingInput, PAIRING_CODE_LENGTH, screenUrl } from "../router";
import { useGameStore } from "../store";
import { formatPairingCode } from "../store/pairing";
import { Button } from "../ui/Button";
import { INVITE_TITLE, shareInvite, type ShareOutcome } from "../ui/share-invite";
import { useBusy } from "../sw/busy";
import { Icon } from "./icons";
import "./PairDevice.css";
import "./OtherScreen.css";

/** True once a code has run out, so the panel can say so and offer a new one. */
function useExpired(expiresAt: string | null): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (expiresAt === null) return;
    const left = Date.parse(expiresAt) - Date.now();
    if (!(left > 0)) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), left);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expired;
}

/** What the leader sends to the other place: the link, and the code in words for a TV that cannot open links. */
export function screenShareText(code: string, url: string): string {
  return `Show our Kids & Dragons game on your TV: open ${url}, or tap Host a game, then Join a game lobby, and type ${formatPairingCode(code)}.`;
}

/**
 * The leader's half, in the Room panel. Folded, so the panel looks as it did
 * until somebody wants it, and it makes nothing until asked: opening it to
 * read is free.
 *
 * `shareable` on the host's own phone or tablet, where a link can be texted;
 * the TV itself shows the code to read out instead.
 */
export function AddScreen({ roomCode, shareable }: { roomCode: string; shareable: boolean }): ReactElement {
  const addScreen = useGameStore((store) => store.addScreen);
  const [made, setMade] = useState<ScreenCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<ShareOutcome | null>(null);
  const expired = useExpired(made?.expiresAt ?? null);
  /*
   * A live code on screen, or one on its way, is not calm for an update reload
   * (sw/converge.ts): the server keeps no way to show it again, so a reload
   * would take it from whoever is reading it out. Released when it runs out.
   */
  useBusy("screen-code-shown", busy || (made !== null && !expired));

  const make = useCallback(async () => {
    setBusy(true);
    setShared(null);
    try {
      const next = await addScreen();
      if (next) setMade(next);
    } finally {
      setBusy(false);
    }
  }, [addScreen]);

  useEffect(() => {
    if (shared !== "copied") return;
    const timer = setTimeout(() => setShared(null), 2500);
    return () => clearTimeout(timer);
  }, [shared]);

  const url = made ? screenUrl(window.location.origin, made.code) : "";
  const onShare = (): void => {
    if (!made) return;
    const env = typeof navigator === "undefined" ? {} : navigator;
    void shareInvite(env, { title: INVITE_TITLE, text: screenShareText(made.code, url), url }).then(setShared);
  };

  return (
    <details className="kad-host__crew-menu kad-screens">
      <summary className="kad-focusable">
        <Icon name="party" /> <span className="kad-screens__title">Another TV</span>{" "}
        <span className="kad-host__hint">Play together from another place</span>
      </summary>
      <div className="kad-screens__body">
        {made === null || expired ? (
          <>
            <p className="kad-host__hint">
              {expired ? (
                "That code ran out. Make a new one when the other TV is ready."
              ) : (
                <>
                  Somebody at another place can show this game on their TV. Their players join on their phones with
                  this room&rsquo;s code, <strong>{roomCode}</strong>.
                </>
              )}
            </p>
            <Button variant="secondary" size="md" block icon={<Icon name="party" />} disabled={busy} onClick={() => void make()}>
              {busy ? "Making a code…" : expired ? "Make a new code" : "Get a code for the other TV"}
            </Button>
          </>
        ) : (
          <div className="pair__card kad-screens__card" role="status">
            <p className="pair__note">
              On the other TV, tap <b>Host a game</b>, then <b>Join a game lobby</b>, and type:
            </p>
            <p className="pair__code" aria-label="Code for the other TV">
              {formatPairingCode(made.code)}
            </p>
            <p className="pair__fine kad-muted">It works one time, for 10 minutes.</p>
            {shareable ? (
              <>
                <Button variant="secondary" size="md" block icon={<Icon name="envelope" />} onClick={onShare}>
                  {shared === "copied" ? "Copied" : "Send it as a link"}
                </Button>
                {shared === "shown" ? (
                  <input
                    className="kad-host__invite-link"
                    readOnly
                    aria-label="Link for the other TV"
                    value={url}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                ) : null}
              </>
            ) : null}
            <Button variant="ghost" size="md" disabled={busy} onClick={() => void make()}>
              Another TV? Make another code
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * The other TV's half, from the start screen. The code arrives typed, or in a
 * `?screen=` link the leader sent, and is never spent until the grown-up taps:
 * a link opened on the wrong device costs nothing.
 */
export function ShowHere({ initialCode, onClose }: { initialCode: string; onClose: () => void }): ReactElement {
  const showFromCode = useGameStore((store) => store.showFromCode);
  const [code, setCode] = useState(() => normalizePairingInput(initialCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const ready = code.length === PAIRING_CODE_LENGTH;
  /*
   * A code typed, or being spent, is not calm for an update reload
   * (sw/converge.ts). Once the server has spent it, the viewer token it answers
   * with is the only way into the game until the store has kept it, which
   * happens before this card goes; a reload in between would leave this TV
   * with a used code and nothing to show for it.
   */
  useBusy("screen-code-entry", busy || code.length > 0);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setCode(normalizePairingInput(e.target.value)), []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // On success the store moves this screen to the game; nothing more to do here.
      await showFromCode(code);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That code didn't work. Ask for a new one?");
      setBusy(false);
    }
  }, [code, showFromCode]);

  return (
    <section className="home__card pair" aria-labelledby="show-here">
      <h2 className="home__card-title" id="show-here">
        <Icon name="party" />
        <span>Join a game lobby</span>
      </h2>
      <p className="home__hint kad-muted">
        Playing together from different places? Whoever runs the game opens <b>Room</b>, then <b>Another TV</b>, and
        gets a code. Type it here and this screen shows their game.
      </p>
      <form
        className="kad-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        <label className="pair__field" htmlFor={fieldId}>
          <span className="pair__label">Code for this TV</span>
          <input
            id={fieldId}
            className="home__text-input pair__input kad-focusable"
            type="text"
            value={formatPairingCode(code)}
            onChange={onChange}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={PAIRING_CODE_LENGTH + 1}
          />
        </label>
        <Button type="submit" variant="primary" size="lg" block icon={<Icon name="forward" />} disabled={!ready || busy}>
          {busy ? "Finding the game…" : "Show the game here"}
        </Button>
      </form>
      {error === null ? null : (
        <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
          <Icon name="close" />
          <span>{error}</span>
        </p>
      )}
      <p className="home__hint kad-muted">Players here join on their phones with the code this screen shows.</p>
      <div className="home__host-toggle">
        <button type="button" className="home__link kad-focusable" onClick={onClose}>
          Back
        </button>
      </div>
    </section>
  );
}
