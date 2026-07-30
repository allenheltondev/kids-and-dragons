/**
 * HomeScreen — the only screen with no session behind it.
 *
 * Two jobs: start a game (choosing Party or Travel mode, spec §2) or join one
 * with a room code (architecture §4.5). Everything else in the app assumes a
 * session exists.
 *
 * This is the one adult-facing screen in the game. Device binding
 * (architecture §4.5) will eventually make even the display name unnecessary —
 * a bound phone already knows who it is — so nothing here is on the path a
 * child walks: she opens the app and taps her avatar.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { RoomMode } from "@kad/shared";
import { useGameStore } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
// The one normalize helper for typed and prefilled codes — the router owns the
// code shape, and a second filter here is how /p/AB1C once prefilled as "ABC".
import { ROOM_CODE_LENGTH as CODE_LENGTH, normalizeCodeInput as normalizeCode } from "../router";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { SignInFlow } from "./SignInFlow";
import "./shared.css";
import "./HomeScreen.css";

const CODE_SLOTS = [0, 1, 2, 3];

const MODE_BLURB: Record<RoomMode, string> = {
  party: "On the TV — the big screen shows the world, phones are controllers.",
  travel: "Phones only — everyone sees the world and their own controls.",
};

const MODE_ICON: Record<RoomMode, string> = { party: "party", travel: "travel" };

export function HomeScreen(): ReactElement {
  const createRoom = useGameStore((s) => s.createRoom);
  const joinRoom = useGameStore((s) => s.joinRoom);

  /**
   * Set when a `/p/:code` URL was opened without a stored session — which is
   * exactly what scanning the lobby QR does. Scanning and then being asked to
   * retype the code you just scanned would make the QR pointless, so it seeds
   * the field and the join section leads.
   */
  const pendingCode = useGameStore((s) => s.pendingCode);

  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<RoomMode>("party");
  const [code, setCode] = useState(() => normalizeCode(pendingCode ?? ""));
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  const [error, setError] = useState<string | null>(null);

  const nameFieldId = useId();
  const nameHintId = useId();

  // Whether this deployment has a user pool at all. Asked once, here, because
  // HomeScreen is the first thing a fresh phone renders (§4.5).
  const checkKeepsake = useKeepsakeStore((s) => s.check);
  const openKeepsake = useKeepsakeStore((s) => s.open);
  const signInAvailable = useKeepsakeStore((s) => s.available) === true;
  useEffect(() => {
    void checkKeepsake();
  }, [checkKeepsake]);

  const trimmedName = displayName.trim();
  const nameReady = trimmedName.length > 0;
  const codeReady = code.length === CODE_LENGTH;

  const onCodeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCode(normalizeCode(e.target.value));
  }, []);

  // `attach()` resolves the URL after this screen has already mounted, so the
  // lazy initial value above can miss it. Seed once, and never over anything
  // already typed.
  useEffect(() => {
    if (pendingCode === null) return;
    setCode((current) => (current === "" ? normalizeCode(pendingCode) : current));
  }, [pendingCode]);

  const start = useCallback(async () => {
    setError(null);
    setBusy("create");
    try {
      await createRoom(mode, trimmedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not start the game.");
    } finally {
      setBusy(null);
    }
  }, [createRoom, mode, trimmedName]);

  const join = useCallback(async () => {
    setError(null);
    setBusy("join");
    try {
      await joinRoom(code, trimmedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work. Try again?");
    } finally {
      setBusy(null);
    }
  }, [joinRoom, code, trimmedName]);

  return (
    <main className="home">
      <div className="home__inner kad-stack">
        <header className="home__masthead">
          <h1 className="home__title">Kids &amp; Dragons</h1>
          <p className="home__tagline kad-muted">Grab a phone. Pick an adventure.</p>
        </header>

        <div className="home__field">
          <label className="home__label" htmlFor={nameFieldId}>
            <Icon name="name" />
            <span>Your name</span>
          </label>
          <input
            id={nameFieldId}
            className="home__text-input kad-focusable"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Type your name"
            autoComplete="nickname"
            enterKeyHint="done"
            maxLength={20}
            aria-describedby={nameHintId}
          />
          <p id={nameHintId} className="home__hint kad-muted">
            This is the name the others see.
          </p>
        </div>

        <section className="home__card" aria-labelledby="home-start">
          <h2 className="home__card-title" id="home-start">
            <Icon name="play" />
            <span>Start a game</span>
          </h2>

          <div className="home__modes" role="radiogroup" aria-label="How are you playing?">
            {(["party", "travel"] as const).map((m) => (
              <label
                key={m}
                className={`home__mode kad-tap${mode === m ? " home__mode--on" : ""}`}
              >
                <input
                  className="home__mode-radio"
                  type="radio"
                  name="room-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span className="home__mode-icon" aria-hidden="true">
                  <Icon name={MODE_ICON[m]} size="2em" />
                </span>
                <span className="home__mode-text">
                  <span className="home__mode-name">
                    {m === "party" ? "Party Mode" : "Travel Mode"}
                    {/* spec §11 — selection is shown by a check glyph, not colour. */}
                    {mode === m ? <Icon name="check" label="Selected" /> : null}
                  </span>
                  <span className="home__mode-blurb kad-muted">{MODE_BLURB[m]}</span>
                </span>
              </label>
            ))}
          </div>

          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="play" />}
            disabled={!nameReady || busy !== null}
            onClick={() => void start()}
          >
            {busy === "create" ? "Starting…" : "Start a game"}
          </Button>
        </section>

        <section className="home__card" aria-labelledby="home-join">
          <h2 className="home__card-title" id="home-join">
            <Icon name="qr" />
            <span>Join a game</span>
          </h2>
          <p className="home__hint kad-muted">Type the four letters on the big screen.</p>

          {/*
            One real input behind four big boxes: on-screen keyboards, paste and
            backspace all behave, and the boxes stay legible for small hands.
          */}
          <label className="home__code">
            <input
              className="home__code-input"
              type="text"
              value={code}
              onChange={onCodeChange}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              enterKeyHint="go"
              aria-label="Room code, four letters"
            />
            <div className="home__code-boxes" aria-hidden="true">
              {CODE_SLOTS.map((i) => (
                <span
                  key={i}
                  className={`home__code-box${code.length === i ? " home__code-box--next" : ""}`}
                >
                  {code[i] ?? ""}
                </span>
              ))}
            </div>
          </label>

          <Button
            variant="secondary"
            size="lg"
            icon={<Icon name="forward" />}
            disabled={!nameReady || !codeReady || busy !== null}
            onClick={() => void join()}
          >
            {busy === "join" ? "Joining…" : "Join a game"}
          </Button>
        </section>

        {busy !== null ? (
          /* A div, not a p: Spinner renders a div, and a block element inside
             a <p> is invalid HTML that React warns about at runtime. */
          <div className="home__busy kad-row" role="status">
            <Spinner />
            <span>{busy === "create" ? "Making a room…" : "Looking for that room…"}</span>
          </div>
        ) : null}

        {error !== null ? (
          <p className="home__error kad-chip kad-chip--bad" role="alert">
            <Icon name="close" />
            <span>{error}</span>
          </p>
        ) : null}

        {/*
         * The new-phone path (§4.5). Deliberately last, small, and phrased for
         * the person it is for: an adult setting up a replacement phone, not a
         * child opening the app. Everyone else never needs it — a bound device
         * already knows who it is, and an unbound one just plays.
         *
         * Renders nothing where sign-in cannot work, which includes local dev.
         */}
        {signInAvailable ? (
          <button
            className="home__restore"
            type="button"
            onClick={() => {
              openKeepsake("restore");
            }}
          >
            <Icon name="lantern" />
            <span>I&rsquo;ve played before on another phone</span>
          </button>
        ) : null}
      </div>

      <SignInFlow />
    </main>
  );
}
