/**
 * AccountScreen (`/account`): the grown-up's errands, off the join screen.
 *
 * The home screen does two things, join a game or host one. Everything here
 * is something a family does once, or when something has gone wrong: sign in
 * so heroes outlive a week away, move a hero to a new device (#281), make a
 * shared tablet (#250), run a group (#248). Each of these used to be a link on
 * the home screen, and nine ways out of one screen is how a grown-up who came
 * to host tapped "I play here already" instead.
 *
 * A lazy chunk, like the guide: nobody waiting to type a room code needs it.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useKeepsakeStore } from "../store/keepsake";
import { navigate, pairingFromSearch } from "../router";
import { loadPlayerDeviceToken } from "../store/persistence";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { LazySignInFlow } from "./HomeScreen";
import "./shared.css";
import "./HomeScreen.css";

const PairHere = lazy(() => import("./PairDevice").then((module) => ({ default: module.PairHere })));
const PlayAsMe = lazy(() => import("./PairDevice").then((module) => ({ default: module.PlayAsMe })));

export function AccountScreen(): ReactElement {
  const checkKeepsake = useKeepsakeStore((s) => s.check);
  const openKeepsake = useKeepsakeStore((s) => s.open);
  const signInAvailable = useKeepsakeStore((s) => s.available) === true;
  const account = useKeepsakeStore((s) => s.account);
  const shared = useKeepsakeStore((s) => s.shared);
  const keepsakeStep = useKeepsakeStore((s) => s.step);
  useEffect(() => {
    void checkKeepsake();
  }, [checkKeepsake]);

  // A tablet just made a family one is nobody's: its home asks who is playing,
  // and the sign-in panel finishes there.
  useEffect(() => {
    if (shared) navigate({ name: "home" }, { replace: true });
  }, [shared]);

  /*
   * Pairing (#281): a scanned QR opens `/account?pair=CODE`. Read once and
   * taken out of the address bar, so a reload or a screenshot of the URL does
   * not carry it around. Spending it is a tap, so a link preview that fetches
   * the page cannot use it up.
   */
  const [pairCode] = useState(() => (typeof window === "undefined" ? null : pairingFromSearch(window.location.search)));
  const [pairing, setPairing] = useState<"none" | "here" | "share">(pairCode === null ? "none" : "here");
  useEffect(() => {
    if (pairCode === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("pair");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [pairCode]);

  // Read again as sign-in moves on: signing in can bind this device to a hero.
  const hasPlayed = useMemo(() => loadPlayerDeviceToken() !== null, [keepsakeStep, account]);

  return (
    <main className="home account" aria-labelledby="account-title">
      <div className="home__inner kad-stack">
        <header className="home__masthead">
          <h1 className="home__card-title account__title" id="account-title">
            <Icon name="lantern" />
            <span>Accounts and devices</span>
          </h1>
          <p className="home__hint kad-muted">For grown-ups. Nobody needs any of this to play.</p>
        </header>

        <div className="home__body home__body--top">
          <Suspense fallback={null}>
            {pairing === "here" ? <PairHere initialCode={pairCode ?? ""} onClose={() => setPairing("none")} /> : null}
            {pairing === "share" ? <PlayAsMe onClose={() => setPairing("none")} /> : null}
          </Suspense>

          {/*
           * Sign in or create an account (§4.5). Signing in, not "keep these":
           * an account that already has a household goes back to it and picks
           * who this phone is, even if the phone has started a guest game
           * since. The server makes that call (`linkAccount` `preferExisting`).
           */}
          {signInAvailable ? (
            <section className="home__card home__account" aria-labelledby="home-account" hidden={pairing !== "none"}>
              <h2 className="home__card-title" id="home-account">
                <Icon name="lantern" />
                {account !== null ? "Your adventurers are saved" : "Save your adventurers"}
              </h2>
              {account !== null ? (
                <p className="home__hint kad-muted" role="status">
                  Signed in as <b className="home__account-email">{account.email}</b>
                </p>
              ) : (
                <>
                  <p className="home__hint kad-muted">Without an account, characters fade after a week away.</p>
                  <Button variant="secondary" block icon={<Icon name="envelope" />} onClick={() => openKeepsake("restore", "home")}>
                    Sign in or create an account
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {/* Moving a hero between devices (#281): a borrowed phone, a hospital tablet. */}
          <section className="home__card home__account" aria-labelledby="account-devices" hidden={pairing !== "none"}>
            <h2 className="home__card-title" id="account-devices">
              <Icon name="qr" />
              <span>Another device</span>
            </h2>
            <p className="home__hint kad-muted">
              A hero lives on the device they were made on. A code moves them to a new one.
            </p>
            <Button variant="secondary" block icon={<Icon name="forward" />} onClick={() => setPairing("here")}>
              Bring my hero to this device
            </Button>
            {hasPlayed ? (
              <Button variant="secondary" block icon={<Icon name="qr" />} onClick={() => setPairing("share")}>
                Play as me on another device
              </Button>
            ) : null}
          </section>

          {signInAvailable ? (
            <section className="home__card home__account" aria-labelledby="account-more" hidden={pairing !== "none"}>
              <h2 className="home__card-title" id="account-more">
                <Icon name="party" />
                <span>More than one kid</span>
              </h2>
              {/* A tablet the kids take turns on (#250): bound to the family,
                  not to whoever played on it last. */}
              <Button variant="secondary" block onClick={() => openKeepsake("share", "home")}>
                Do the kids share this device? Make it a family tablet
              </Button>
              {/* #248: a club, a class, the cousins. One grown-up or several. */}
              <Button variant="secondary" block onClick={() => openKeepsake("organize", "home")}>
                Running games for kids from other families? Run a group
              </Button>
            </section>
          ) : null}

          <div className="account__back">
            <Button variant="secondary" icon={<Icon name="back" />} onClick={() => navigate({ name: "home" })}>
              Back to the start
            </Button>
          </div>
        </div>
      </div>

      <LazySignInFlow />
    </main>
  );
}

export default AccountScreen;
