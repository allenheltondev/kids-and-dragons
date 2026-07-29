/**
 * SignInFlow — the optional sign-in, architecture §4.5.
 *
 * This is the one screen in the game that exists for a grown-up, and its whole
 * job is to be skippable. Anonymous play already works; this only decides
 * whether it is *remembered*. So:
 *
 *   - It opens from a button and closes on a tap, over a game that keeps
 *     running underneath. Nothing here is a gate.
 *   - It leads with the party, drawn as lights in a lantern, because what is
 *     being kept is three characters and not "your data".
 *   - It never says "account", "sign up", "register", or "password". There is
 *     no password in the pool at all.
 *
 * The steps are `offer → email → code → passkey → kept`, and every one of them
 * has a way out that leaves the game exactly as it was.
 *
 * It renders in the **PlayerView**, phone-first (roadmap: "Travel layout
 * first"), and is sized in `em` against its surface like everything else — the
 * same panel has to work at 40% of a phone in Travel Mode.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useKeepsakeStore } from "../store/keepsake";
import { useParty } from "../store";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { KeepsakeLantern } from "./KeepsakeLantern";
import "./shared.css";
import "./SignInFlow.css";

/** Cognito's email OTP. */
const CODE_LENGTH = 6;

export function SignInFlow(): ReactElement | null {
  const step = useKeepsakeStore((s) => s.step);
  const busy = useKeepsakeStore((s) => s.busy);
  const error = useKeepsakeStore((s) => s.error);
  const close = useKeepsakeStore((s) => s.close);
  const party = useParty();

  /*
   * The flame is the *character's* accent colour, not the player's UI colour.
   * It is the colour her unicorn is actually drawn in, so the lights in the
   * lantern match the three figures still standing on the TV — which is the
   * whole reason the picture works.
   */
  const motes = party.map((member) => ({
    id: member.playerId,
    color: member.character.appearance.accent,
    name: member.character.name,
  }));

  if (step === "closed") return null;

  return (
    <div className="keepsake" role="dialog" aria-modal="false" aria-labelledby="keepsake-title">
      <div className="keepsake__panel">
        <Button
          className="keepsake__close"
          variant="ghost"
          icon={<Icon name="close" label="Not now" />}
          onClick={close}
        />

        <KeepsakeLantern motes={motes} tone={step === "kept" ? "kept" : "offer"} />

        {error === null ? null : (
          <p className="keepsake__error" role="alert">
            <Icon name="close" />
            <span>{error}</span>
          </p>
        )}

        {step === "offer" ? <OfferStep motes={motes} /> : null}
        {step === "email" ? <EmailStep busy={busy} /> : null}
        {step === "code" ? <CodeStep busy={busy} /> : null}
        {step === "choose" ? <ChooseStep busy={busy} /> : null}
        {step === "passkey" ? <PasskeyStep busy={busy} /> : null}
        {step === "kept" ? <KeptStep motes={motes} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface Mote {
  id: string;
  color: string;
  name: string;
}

/**
 * Exported for tests, not for callers — `SignInFlow` is the only thing that
 * should ever render a step. It takes its party as a prop precisely so the copy
 * can be asserted without a DOM: zustand serves `getInitialState()` as the SSR
 * snapshot, so a store-driven render cannot be steered by `setState`.
 */
export function OfferStep({ motes }: { motes: Mote[] }): ReactElement {
  const store = useKeepsakeStore();

  return (
    <>
      <h2 className="keepsake__title" id="keepsake-title">
        Keep {namesOf(motes)}?
      </h2>
      <p className="keepsake__body">
        {/*
         * The honest version of the deal, in one sentence, with the cost of
         * saying no stated plainly rather than implied. A vague "your progress
         * may be lost" would be both scarier and less true.
         *
         * Phrased around "they" rather than "these", which reads correctly for
         * one character and for three — the party is 1–3 people and a sentence
         * that needs a plural branch will eventually get the branch wrong.
         */}
        Right now they only live on this phone, for <b>seven days</b>. Add an
        email and they stay for good — levels, items and all.
      </p>
      <ul className="keepsake__party">
        {motes.map((mote) => (
          <li className="keepsake__member" key={mote.id}>
            <span className="keepsake__dot" style={{ background: mote.color }} aria-hidden="true" />
            <span>{mote.name}</span>
          </li>
        ))}
      </ul>

      <div className="keepsake__actions">
        <Button
          variant="primary"
          size="lg"
          block
          icon={<Icon name="keepsake" />}
          onClick={() => {
            useKeepsakeStore.setState({ step: "email", error: null });
          }}
        >
          Keep them
        </Button>
        {/* "Not now" rather than "No thanks": the offer comes back next time,
            and saying so is what makes declining it cheap. */}
        <Button variant="ghost" icon={<Icon name="back" />} onClick={store.close}>
          Not now
        </Button>
      </div>
      <p className="keepsake__fine kad-muted">No password. We only use it to find them again.</p>
    </>
  );
}

function EmailStep({ busy }: { busy: boolean }): ReactElement {
  const sendCode = useKeepsakeStore((s) => s.sendCode);
  const close = useKeepsakeStore((s) => s.close);
  const [email, setEmail] = useState("");
  const fieldId = useId();

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void sendCode(email);
    },
    [email, sendCode],
  );

  return (
    <form className="keepsake__form" onSubmit={onSubmit}>
      <h2 className="keepsake__title" id="keepsake-title">
        What&rsquo;s your email?
      </h2>
      <p className="keepsake__body">We&rsquo;ll send a six-digit code. That&rsquo;s the whole thing.</p>

      <label className="keepsake__label" htmlFor={fieldId}>
        <Icon name="envelope" />
        <span>Email</span>
      </label>
      <input
        className="keepsake__input"
        id={fieldId}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // The adult is on their own phone here, and this is the only text field
        // in the game an adult ever fills in — so it is safe to take focus.
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setEmail(e.target.value);
        }}
        disabled={busy}
      />

      <div className="keepsake__actions">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={busy || !email.includes("@")}
          icon={busy ? <Spinner /> : <Icon name="envelope" />}
        >
          {busy ? "Sending…" : "Send the code"}
        </Button>
        <Button variant="ghost" icon={<Icon name="back" />} onClick={close} disabled={busy}>
          Not now
        </Button>
      </div>
    </form>
  );
}

function CodeStep({ busy }: { busy: boolean }): ReactElement {
  const submitCode = useKeepsakeStore((s) => s.submitCode);
  const back = useKeepsakeStore((s) => s.back);
  const challenge = useKeepsakeStore((s) => s.challenge);
  const [code, setCode] = useState("");
  const fieldId = useId();
  const submitted = useRef("");

  const ready = code.length === CODE_LENGTH;

  /*
   * Submit as soon as the sixth digit lands. Typing six digits and then hunting
   * for a button is the step people abandon, and a phone keyboard covers the
   * button anyway. The guard stops a re-render (or a paste) firing it twice.
   */
  useEffect(() => {
    if (!ready || busy || submitted.current === code) return;
    submitted.current = code;
    void submitCode(code);
  }, [ready, busy, code, submitCode]);

  return (
    <form
      className="keepsake__form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (ready) void submitCode(code);
      }}
    >
      <h2 className="keepsake__title" id="keepsake-title">
        Check your email
      </h2>
      <p className="keepsake__body">
        We sent six digits to <b>{challenge?.destination ?? challenge?.email ?? "your inbox"}</b>.
      </p>

      <label className="keepsake__label" htmlFor={fieldId}>
        <Icon name="envelope" />
        <span>The code</span>
      </label>
      <input
        className="keepsake__input keepsake__input--code"
        id={fieldId}
        type="text"
        inputMode="numeric"
        // Lets both iOS and Android offer the code straight from the SMS/email
        // notification, which removes the app-switch entirely.
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        autoFocus
        placeholder="000000"
        value={code}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
          // Clear the guard when the code changes, so a corrected digit can
          // resubmit after a CodeMismatch.
          if (next !== submitted.current) submitted.current = "";
          setCode(next);
        }}
        disabled={busy}
      />

      <div className="keepsake__actions">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={busy || !ready}
          icon={busy ? <Spinner /> : <Icon name="check" />}
        >
          {busy ? "Keeping…" : "Keep them"}
        </Button>
        <Button variant="ghost" icon={<Icon name="back" />} onClick={back} disabled={busy}>
          Different email
        </Button>
      </div>
    </form>
  );
}

/**
 * The `restore` ending — "which one of you is this phone?"
 *
 * Asked rather than guessed. The server deliberately refuses to pick
 * (`linkAccount` returns players and no token, §4.5), because binding the wrong
 * phone to a child's profile hands her adult's device to her — and binding hers
 * to an adult gives a `role: child` device pairing rights it must never have.
 */
function ChooseStep({ busy }: { busy: boolean }): ReactElement {
  const players = useKeepsakeStore((s) => s.players);
  const choosePlayer = useKeepsakeStore((s) => s.choosePlayer);

  return (
    <>
      <h2 className="keepsake__title" id="keepsake-title">
        Who&rsquo;s holding this phone?
      </h2>
      <p className="keepsake__body">We&rsquo;ll set it up as them, for good.</p>

      <ul className="keepsake__choices">
        {players.map((player) => (
          <li key={player.id}>
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={busy}
              icon={
                <span
                  className="keepsake__dot keepsake__dot--lg"
                  style={{ background: player.color }}
                  aria-hidden="true"
                />
              }
              onClick={() => void choosePlayer(player.id)}
            >
              {player.displayName}
              {player.characters.length > 0 ? (
                <span className="keepsake__choice-sub"> — {player.characters.join(", ")}</span>
              ) : null}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PasskeyStep({ busy }: { busy: boolean }): ReactElement {
  const addPasskey = useKeepsakeStore((s) => s.addPasskey);
  const skipPasskey = useKeepsakeStore((s) => s.skipPasskey);
  const purpose = useKeepsakeStore((s) => s.purpose);

  return (
    <>
      <h2 className="keepsake__title" id="keepsake-title">
        {purpose === "keep" ? "They’re kept." : "Found them."}
      </h2>
      <p className="keepsake__body">
        Want to skip the email next time? This phone can remember you with a
        fingerprint or face.
      </p>
      <div className="keepsake__actions">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={busy}
          icon={busy ? <Spinner /> : <Icon name="passkey" />}
          onClick={() => void addPasskey()}
        >
          {busy ? "Asking…" : "Remember this phone"}
        </Button>
        <Button variant="ghost" icon={<Icon name="forward" />} onClick={skipPasskey} disabled={busy}>
          Skip
        </Button>
      </div>
    </>
  );
}

function KeptStep({ motes }: { motes: Mote[] }): ReactElement {
  const close = useKeepsakeStore((s) => s.close);
  const passkeyAdded = useKeepsakeStore((s) => s.passkeyAdded);
  const account = useKeepsakeStore((s) => s.account);
  const purpose = useKeepsakeStore((s) => s.purpose);

  // On the home screen there is no room and therefore no party to name — the
  // characters are in the household, waiting, not on the board yet.
  const restored = purpose === "restore" || motes.length === 0;

  return (
    <>
      <h2 className="keepsake__title" id="keepsake-title">
        {restored ? "This phone is set up." : `${namesOf(motes)} ${motes.length === 1 ? "is" : "are"} safe.`}
      </h2>
      <p className="keepsake__body">
        {restored ? (
          <>
            Signed in as <b>{account?.email ?? "you"}</b>. Start or join a game and your
            character will be there.
          </>
        ) : (
          <>
            Kept under <b>{account?.email ?? "your email"}</b>. They&rsquo;ll be here next
            time, with everything they&rsquo;re carrying.
          </>
        )}
      </p>
      {passkeyAdded ? (
        <p className="keepsake__body keepsake__body--note">
          <Icon name="passkey" />
          <span>This phone will remember you — no code next time.</span>
        </p>
      ) : null}
      <div className="keepsake__actions">
        <Button variant="primary" size="lg" block icon={<Icon name="forward" />} onClick={close}>
          Back to the game
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * The card that opens the flow, rendered on the chapter-complete panel.
 *
 * Renders **nothing** in three cases, and each is deliberate:
 *
 *   - the deployment has no user pool (local dev), so there is nothing to offer
 *   - it is still finding that out — `available === null`. Showing the offer
 *     and then withdrawing it is worse than showing it a moment late.
 *   - this household has already been claimed, so the question is answered
 *
 * The third is why the offer does not nag: once somebody says yes, this
 * disappears for good on that device rather than becoming a permanent
 * "manage your account" affordance in a game a child plays.
 */
export function shouldOfferKeepsake(
  available: boolean | null,
  claimed: boolean,
  partySize: number,
): boolean {
  return available === true && !claimed && partySize > 0;
}

export function KeepsakeOffer(): ReactElement | null {
  const available = useKeepsakeStore((s) => s.available);
  const account = useKeepsakeStore((s) => s.account);
  const open = useKeepsakeStore((s) => s.open);
  const party = useParty();

  if (!shouldOfferKeepsake(available, account !== null, party.length)) return null;

  const motes = party.map((member) => ({
    id: member.playerId,
    color: member.character.appearance.accent,
    name: member.character.name,
  }));

  return (
    // Wrapped, not passed directly: `open` takes an optional purpose, and
    // handing it straight to onClick would pass a MouseEvent as that argument.
    <button
      className="keepsake-offer"
      type="button"
      onClick={() => {
        open("keep");
      }}
    >
      <KeepsakeLantern className="keepsake-offer__lantern" motes={motes} />
      <span className="keepsake-offer__text">
        <span className="keepsake-offer__lead">Keep {namesOf(motes)}?</span>
        <span className="keepsake-offer__sub">
          They&rsquo;re only on this phone for seven days.
        </span>
      </span>
      <Icon name="forward" />
    </button>
  );
}

/** "Sparklehoof", "Sparklehoof and Ember", "Sparklehoof, Ember and Rue". */
export function namesOf(motes: readonly { name: string }[]): string {
  const names = motes.map((m) => m.name).filter(Boolean);
  if (names.length === 0) return "your characters";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}
