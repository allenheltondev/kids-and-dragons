/**
 * Pairing a new device to a kid (#281): the two halves of one handoff.
 *
 * `PlayAsMe` is on her own phone: it makes a one-time code and shows it with
 * a QR. `PairHere` is on the fresh device's home screen ("I play here
 * already"): it takes the code, typed or arriving from a scanned QR, and the
 * device becomes her. `PairingCodeCard` is the drawing both a kid's phone and
 * a grown-up's organizer panel use for a code.
 *
 * Kid-facing copy: short, US spelling, no dashes for breath.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import type { PairingCode } from "@kad/shared";
import { api } from "../sync/client";
import { navigate, normalizePairingInput, pairingUrl, PAIRING_CODE_LENGTH } from "../router";
import { loadPlayerDeviceToken } from "../store/persistence";
import { formatPairingCode, pairThisDevice } from "../store/pairing";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import "./PairDevice.css";

/** The QR is a convenience: the code is always readable beside it. */
function usePairingQr(code: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (code === null) {
      setDataUrl(null);
      return;
    }
    let live = true;
    void import("qrcode")
      .then(({ toDataURL }) =>
        toDataURL(pairingUrl(window.location.origin, code), {
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

/** True once the code has run out, so the screen can say so and offer a new one. */
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

/** A code, a QR, and how long they last. */
export function PairingCodeCard({
  pairing,
  busy,
  onNew,
}: {
  pairing: PairingCode;
  busy: boolean;
  onNew: () => void;
}): ReactElement {
  const expired = useExpired(pairing.expiresAt);
  const qr = usePairingQr(expired ? null : pairing.code);
  return (
    <div className="pair__card" role="status">
      {expired ? (
        <>
          <p className="pair__note">That code ran out. Make a new one.</p>
          <Button variant="primary" block disabled={busy} onClick={onNew} icon={<Icon name="forward" />}>
            Make a new code
          </Button>
        </>
      ) : (
        <>
          <p className="pair__note">
            On the other device, tap <b>Bring my hero to this device</b> and type this. Or scan the picture.
          </p>
          <p className="pair__code" aria-label={`Code for ${pairing.playerName}`}>
            {formatPairingCode(pairing.code)}
          </p>
          {qr === null ? null : (
            <img className="pair__qr" src={qr} alt={`QR code to play as ${pairing.playerName}`} width={256} height={256} />
          )}
          <p className="pair__fine kad-muted">It works one time, for 10 minutes.</p>
        </>
      )}
    </div>
  );
}

/** On her own phone: "Play as me on another device". */
export function PlayAsMe({ onClose }: { onClose: () => void }): ReactElement {
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = useCallback(async () => {
    const token = loadPlayerDeviceToken();
    if (token === null) {
      setError("This phone isn't one of your players yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPairing(await api.createPairingCode(token));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "We could not make a code. Try again?");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void make();
  }, [make]);

  return (
    <section className="home__card pair" aria-labelledby="pair-share">
      <h2 className="home__card-title" id="pair-share">
        <Icon name="qr" />
        <span>Play as me on another device</span>
      </h2>
      {pairing === null ? (
        busy ? (
          <div className="pair__busy kad-row" role="status">
            <Spinner size="sm" />
            <span>Making your code…</span>
          </div>
        ) : null
      ) : (
        <PairingCodeCard pairing={pairing} busy={busy} onNew={() => void make()} />
      )}
      {error === null ? null : (
        <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
          <Icon name="close" />
          <span>{error}</span>
        </p>
      )}
      <Button variant="secondary" block onClick={onClose}>
        Done
      </Button>
    </section>
  );
}

/**
 * On a fresh device: "Bring my hero to this device". `note` replaces where to
 * get the code, for an installed app whose hero is in the browser on this same
 * phone (#412).
 */
export function PairHere({
  initialCode,
  onClose,
  note,
}: {
  initialCode: string;
  onClose: () => void;
  note?: ReactNode;
}): ReactElement {
  const [code, setCode] = useState(() => normalizePairingInput(initialCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const ready = code.length === PAIRING_CODE_LENGTH;
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setCode(normalizePairingInput(e.target.value)), []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await pairThisDevice(code);
      // Straight to her hero: the book opens on it.
      navigate({ name: "journal" });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That code didn't work. Try again?");
      setBusy(false);
    }
  }, [code]);

  return (
    <section className="home__card pair" aria-labelledby="pair-here">
      <h2 className="home__card-title" id="pair-here">
        <Icon name="qr" />
        <span>Bring my hero to this device</span>
      </h2>
      <p className="home__hint kad-muted">
        {note ?? (
          <>
            On your other phone, tap <b>Play as me on another device</b>. Then type the letters here, or scan the
            picture with this camera.
          </>
        )}
      </p>
      <label className="pair__field" htmlFor={fieldId}>
        <span className="pair__label">Your code</span>
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
      <Button
        variant="primary"
        size="lg"
        block
        icon={<Icon name="forward" />}
        disabled={!ready || busy}
        onClick={() => void submit()}
      >
        {busy ? "Checking…" : "That's me"}
      </Button>
      {error === null ? null : (
        <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
          <Icon name="close" />
          <span>{error}</span>
        </p>
      )}
      <div className="home__host-toggle">
        <button type="button" className="home__link kad-focusable" onClick={onClose}>
          Back
        </button>
      </div>
    </section>
  );
}
