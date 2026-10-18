/**
 * OrganizerPanel — a grown-up running games for kids who are not all theirs
 * (#248): a club, a class, a gaggle of cousins.
 *
 * The last step of the sign-in flow when it was opened to organize, inside
 * the same panel, so it closes on the same tap and leaves nobody signed in.
 * Two views:
 *
 *   - **the picker**: every household this account owns (its family, its
 *     groups), "Start a new group", and "Have an organizer code?" for joining
 *     somebody else's as a co-organizer.
 *   - **one household**: its kids (add, rename, retire, bring back, move one
 *     to another home) with their heroes, and its organizers (invite one,
 *     take one off, leave).
 *
 * A move code (#251) is made on one kid's row and redeemed from either view:
 * the picker takes her into a brand-new home, a household takes her into it.
 *
 * Written for the adult holding it, in the plain words the rest of the
 * sign-in flow uses. Kids never see this; they tap their face on a tablet.
 */

import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type {
  OrganizerDevice,
  OrganizerHero,
  OrganizerHouseholdView,
  OrganizerOwner,
  OrganizerPlayer,
  TransferCode,
} from "@kad/shared";
import { formatInviteCode, useOrganizerStore } from "../store/organizer";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { PairingCodeCard } from "./PairDevice";
import { lastUsed, tabletName } from "./tablet-label";
import { KeepsakeError } from "./SignInFlow";
import "./OrganizerPanel.css";

/** Matches the server's limits (handlers/organizer.ts, shared-device.ts). */
const GROUP_NAME_MAX = 40;
const KID_NAME_MAX = 24;

export function OrganizerPanel({ onDone }: { onDone: () => void }): ReactElement {
  const view = useOrganizerStore((s) => s.view);
  const email = useOrganizerStore((s) => s.email);
  const busy = useOrganizerStore((s) => s.busy);
  const error = useOrganizerStore((s) => s.error);

  return (
    <div className="organizer">
      {view ? <HouseholdView view={view} busy={busy} /> : <HouseholdPicker busy={busy} />}
      <KeepsakeError error={error} />
      <div className="keepsake__actions">
        <Button variant="primary" size="lg" block icon={<Icon name="check" />} onClick={onDone} disabled={busy}>
          Done
        </Button>
      </div>
      {email ? (
        <p className="keepsake__fine kad-muted">
          Signed in as <b>{email}</b> until you tap Done.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

function HouseholdPicker({ busy }: { busy: boolean }): ReactElement {
  const households = useOrganizerStore((s) => s.households);
  const openHousehold = useOrganizerStore((s) => s.openHousehold);
  const createGroup = useOrganizerStore((s) => s.createGroup);
  const acceptInvite = useOrganizerStore((s) => s.acceptInvite);
  const acceptTransfer = useOrganizerStore((s) => s.acceptTransfer);
  const pendingMove = useOrganizerStore((s) => s.pendingMove);

  return (
    <>
      <h2 className="keepsake__title" id="keepsake-title">
        Your groups
      </h2>
      <p className="keepsake__body">
        A group is for kids from more than one family: a club, a class, the cousins. You can run one
        on your own or with other grown-ups.
      </p>

      {households.length > 0 ? (
        <ul className="keepsake__choices">
          {households.map((household) => (
            <li key={household.id}>
              <Button
                variant="secondary"
                size="lg"
                block
                disabled={busy}
                icon={<Icon name="party" />}
                onClick={() => void openHousehold(household.id)}
              >
                {household.displayName}
                <span className="keepsake__choice-sub">: {kidsCount(household.players)}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : busy ? (
        <Spinner />
      ) : null}

      <NameForm
        label="Start a new group"
        placeholder="Thursday Dragon Club"
        maxLength={GROUP_NAME_MAX}
        submit="Start it"
        icon="plus"
        busy={busy}
        onSubmit={(name) => createGroup(name)}
      />
      <NameForm
        label="Have an organizer code?"
        placeholder="ABCDE-FGHJK"
        maxLength={11}
        submit="Join as an organizer"
        icon="forward"
        busy={busy}
        code
        onSubmit={(code) => acceptInvite(code)}
      />
      <NameForm
        label="Taking a kid home? Their move code"
        placeholder="ABCDE-FGHJK"
        maxLength={11}
        submit="Bring them home"
        icon="forward"
        busy={busy}
        code
        {...(pendingMove ? { initial: formatInviteCode(pendingMove) } : {})}
        onSubmit={(code) => acceptTransfer(code)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// One household
// ---------------------------------------------------------------------------

function HouseholdView({ view, busy }: { view: OrganizerHouseholdView; busy: boolean }): ReactElement {
  const households = useOrganizerStore((s) => s.households);
  const backToList = useOrganizerStore((s) => s.backToList);
  const edit = useOrganizerStore((s) => s.edit);
  const transfer = useOrganizerStore((s) => s.transfer);
  const arrived = useOrganizerStore((s) => s.arrived);
  const acceptTransfer = useOrganizerStore((s) => s.acceptTransfer);
  const pendingMove = useOrganizerStore((s) => s.pendingMove);
  const [renaming, setRenaming] = useState(false);

  const active = view.players.filter((p) => !p.retired);
  const retired = view.players.filter((p) => p.retired);

  return (
    <>
      {households.length !== 1 ? (
        <Button variant="ghost" icon={<Icon name="back" />} onClick={() => void backToList()} disabled={busy}>
          All your groups
        </Button>
      ) : null}

      {renaming ? (
        <NameForm
          label="Group name"
          initial={view.displayName}
          maxLength={GROUP_NAME_MAX}
          submit="Save"
          icon="check"
          busy={busy}
          onSubmit={async (displayName) => {
            await edit({ action: "rename-household", displayName });
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div className="organizer__title">
          <h2 className="keepsake__title" id="keepsake-title">
            {view.displayName}
          </h2>
          <button type="button" className="organizer__link kad-focusable" onClick={() => setRenaming(true)} disabled={busy}>
            Rename
          </button>
        </div>
      )}

      <section className="organizer__section" aria-label="Kids">
        <h3 className="organizer__heading">
          <Icon name="party" />
          <span>Kids</span>
        </h3>
        {arrived && arrived.household.id === view.id ? (
          <p className="keepsake__body organizer__arrived" role="status">
            {arrived.displayName} lives here now, with {heroesCount(arrived.heroes)}.
          </p>
        ) : null}
        {active.length === 0 ? (
          <p className="keepsake__body">
            Nobody yet. Add the kids here, or they can tap &ldquo;Someone new&rdquo; on the group&rsquo;s tablet.
          </p>
        ) : (
          <ul className="organizer__list">
            {active.map((player) => (
              <PlayerRow key={player.id} player={player} busy={busy} />
            ))}
          </ul>
        )}
        <NameForm
          label="Add a kid"
          placeholder="Their name"
          maxLength={KID_NAME_MAX}
          submit="Add"
          icon="plus"
          busy={busy}
          onSubmit={(displayName) => edit({ action: "add-player", displayName })}
        />
        {transfer ? <TransferCard transfer={transfer} /> : null}
        <NameForm
          label="Bringing a kid here? Their move code"
          placeholder="ABCDE-FGHJK"
          maxLength={11}
          submit="Bring them here"
          icon="forward"
          busy={busy}
          code
          {...(pendingMove ? { initial: formatInviteCode(pendingMove) } : {})}
          onSubmit={(code) => acceptTransfer(code)}
        />
        {retired.length > 0 ? (
          <>
            <h4 className="organizer__subheading">Taken off the list</h4>
            <ul className="organizer__list">
              {retired.map((player) => (
                <PlayerRow key={player.id} player={player} busy={busy} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <TabletsSection busy={busy} />

      <OrganizersSection view={view} busy={busy} />
    </>
  );
}

function PlayerRow({ player, busy }: { player: OrganizerPlayer; busy: boolean }): ReactElement {
  const edit = useOrganizerStore((s) => s.edit);
  const makeTransfer = useOrganizerStore((s) => s.makeTransfer);
  const makePairing = useOrganizerStore((s) => s.makePairing);
  const pairing = useOrganizerStore((s) => (s.pairing?.playerId === player.id ? s.pairing.code : null));
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <li className="organizer__row">
        <NameForm
          label={`Rename ${player.displayName}`}
          initial={player.displayName}
          maxLength={KID_NAME_MAX}
          submit="Save"
          icon="check"
          busy={busy}
          onSubmit={async (displayName) => {
            await edit({ action: "rename-player", playerId: player.id, displayName });
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      </li>
    );
  }

  return (
    <>
    <li className={`organizer__row${player.retired ? " organizer__row--retired" : ""}`}>
      <span className="keepsake__dot" style={{ background: player.color }} aria-hidden="true" />
      <span className="organizer__who">
        <b>{player.displayName}</b>
        <span className="organizer__heroes kad-muted">
          {player.heroes.length === 0
            ? "No hero yet"
            : player.heroes
                .map((h) => `${h.name}, level ${h.level}${h.adventure ? `, in ${h.adventure}` : ""}`)
                .join(" · ")}
        </span>
        {player.heroes
          .filter((h) => h.adventure)
          .map((h) => (
            <EndAdventure key={h.id} hero={h} busy={busy} />
          ))}
      </span>
      <span className="organizer__row-actions">
        {player.retired ? null : (
          <button type="button" className="organizer__link kad-focusable" onClick={() => setRenaming(true)} disabled={busy}>
            Rename
          </button>
        )}
        {/* A one-time code for a new device (#281): a hospital tablet, a borrowed phone. */}
        {player.retired ? null : (
          <button
            type="button"
            className="organizer__link kad-focusable"
            onClick={() => void makePairing(player.id)}
            disabled={busy}
            aria-label={`Play as ${player.displayName} on another device`}
          >
            Pair a device
          </button>
        )}
        <button
          type="button"
          className="organizer__link kad-focusable"
          disabled={busy}
          onClick={() => void edit({ action: "retire-player", playerId: player.id, retired: !player.retired })}
        >
          {player.retired ? "Bring back" : "Take off"}
        </button>
        <button
          type="button"
          className="organizer__link kad-focusable"
          disabled={busy}
          onClick={() => void makeTransfer(player.id)}
        >
          Move home
        </button>
      </span>
    </li>
    {pairing ? (
      <li className="organizer__row organizer__pairing">
        <PairingCodeCard pairing={pairing} busy={busy} onNew={() => void makePairing(player.id)} />
      </li>
    ) : null}
    </>
  );
}

/**
 * End the campaign a hero is in (#282), so she can join another table. Her
 * gains from it go, so the first tap only asks.
 */
function EndAdventure({ hero, busy }: { hero: OrganizerHero; busy: boolean }): ReactElement {
  const edit = useOrganizerStore((s) => s.edit);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="organizer__link kad-focusable" disabled={busy} onClick={() => setAsking(true)}>
        End {hero.adventure} for {hero.name}
      </button>
    );
  }
  return (
    <span className="organizer__confirm" role="group" aria-label={`End ${hero.adventure} for ${hero.name}`}>
      <span className="kad-muted">What {hero.name} gained in {hero.adventure} goes away.</span>
      <button
        type="button"
        className="organizer__link kad-focusable"
        disabled={busy}
        onClick={() => void edit({ action: "leave-adventure", characterId: hero.id })}
      >
        End it
      </button>
      <button type="button" className="organizer__link kad-focusable" disabled={busy} onClick={() => setAsking(false)}>
        Keep playing it
      </button>
    </span>
  );
}

/**
 * The household's shared tablets (#273): the way to forget one that is lost,
 * broken or left at a grandparent's, from any signed-in device.
 */
function TabletsSection({ busy }: { busy: boolean }): ReactElement {
  const devices = useOrganizerStore((s) => s.devices);
  const forgetDevice = useOrganizerStore((s) => s.forgetDevice);

  return (
    <section className="organizer__section" aria-label="Family tablets">
      <h3 className="organizer__heading">
        <Icon name="travel" />
        <span>Family tablets</span>
      </h3>
      {devices.length === 0 ? (
        <p className="keepsake__body">No family tablets set up yet.</p>
      ) : (
        <ul className="organizer__list">
          {devices.map((device) => (
            <TabletRow key={device.deviceId} device={device} busy={busy} onForget={() => void forgetDevice(device.deviceId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TabletRow({ device, busy, onForget }: { device: OrganizerDevice; busy: boolean; onForget(): void }): ReactElement {
  const name = tabletName(device.userAgent);
  return (
    <li className="organizer__row">
      <span className="organizer__who">
        <b>{name}</b>
        <span className="organizer__heroes kad-muted">Last used {lastUsed(device.lastSeen, Date.now())}</span>
      </span>
      <span className="organizer__row-actions">
        <button
          type="button"
          className="organizer__link kad-focusable"
          disabled={busy}
          aria-label={`Forget this ${name}`}
          onClick={onForget}
        >
          Forget
        </button>
      </span>
    </li>
  );
}

function OrganizersSection({ view, busy }: { view: OrganizerHouseholdView; busy: boolean }): ReactElement {
  const invite = useOrganizerStore((s) => s.invite);
  const makeInvite = useOrganizerStore((s) => s.makeInvite);
  const removeOrganizer = useOrganizerStore((s) => s.removeOrganizer);

  return (
    <section className="organizer__section" aria-label="Grown-ups">
      <h3 className="organizer__heading">
        <Icon name="lantern" />
        <span>Grown-ups who run it</span>
      </h3>
      <ul className="organizer__list">
        {view.owners.map((owner) => (
          <li className="organizer__row" key={owner.id}>
            <span className="organizer__who">
              <b>{ownerName(owner)}</b>
              {owner.founding ? <span className="organizer__heroes kad-muted">Started it</span> : null}
            </span>
            {owner.founding ? null : (
              <span className="organizer__row-actions">
                <button
                  type="button"
                  className="organizer__link kad-focusable"
                  disabled={busy}
                  onClick={() => void removeOrganizer(owner.id)}
                >
                  {owner.you ? "Leave" : "Take off"}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {invite ? (
        <div className="organizer__invite" role="status">
          <p className="keepsake__body">Give this code to the other grown-up:</p>
          <p className="organizer__code">{formatInviteCode(invite.code)}</p>
          <p className="keepsake__fine kad-muted">
            They sign in, tap &ldquo;Run a group&rdquo;, and type it. It works once, for three days.
          </p>
        </div>
      ) : (
        <Button variant="secondary" block icon={<Icon name="plus" />} disabled={busy} onClick={() => void makeInvite()}>
          Invite another grown-up
        </Button>
      )}
    </section>
  );
}

/**
 * One kid's move code (#251), for the grown-up taking her home: a QR to scan
 * from this screen and the same code to type or text. Shown once; making
 * another is a new code, and the old one still works until it is used.
 */
function TransferCard({ transfer }: { transfer: TransferCode }): ReactElement {
  const dismiss = useOrganizerStore((s) => s.dismissTransfer);
  const qr = useQr(moveUrl(transfer.code));
  const name = transfer.displayName;
  return (
    <div className="organizer__invite organizer__transfer" role="status" aria-label={`${name}'s move code`}>
      <p className="keepsake__body">
        To move <b>{name}</b> to another home, give this to the grown-up taking {name} home:
      </p>
      {qr ? <img className="organizer__qr" src={qr} alt={`QR code to move ${name}`} /> : null}
      <p className="organizer__code">{formatInviteCode(transfer.code)}</p>
      <p className="keepsake__fine kad-muted">
        They sign in, tap &ldquo;Run a group&rdquo;, and scan or type it. {name}&rsquo;s heroes, finds and own phone
        go too, and leave here. Saved games stay here. It works once, for a day.
      </p>
      <Button variant="ghost" icon={<Icon name="close" />} onClick={dismiss}>
        Hide the code
      </Button>
    </div>
  );
}

/** Where a scanned move code lands: home, which opens the organizer panel with it typed in. */
function moveUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?move=${encodeURIComponent(code)}`;
}

/** A QR, loaded on demand like the lobby's, and simply absent if it cannot be drawn. */
function useQr(text: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then(({ toDataURL }) =>
        toDataURL(text, { margin: 1, width: 384, errorCorrectionLevel: "M", color: { dark: "#12102a", light: "#ffffff" } }),
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
  }, [text]);
  return dataUrl;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface NameFormProps {
  label: string;
  placeholder?: string;
  initial?: string;
  maxLength: number;
  submit: string;
  icon: string;
  busy: boolean;
  /** An organizer code: shown in capitals, no autocorrect. */
  code?: boolean;
  onSubmit(value: string): Promise<void>;
  onCancel?(): void;
}

/** One labeled field and its button, for every name and code on this panel. */
function NameForm(props: NameFormProps): ReactElement {
  const [value, setValue] = useState(props.initial ?? "");
  const fieldId = useId();
  const ready = value.trim().length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || props.busy) return;
    void props.onSubmit(value.trim()).then(() => {
      if (props.initial === undefined) setValue("");
    });
  };

  return (
    <form className="keepsake__form organizer__form" onSubmit={onSubmit}>
      <label className="keepsake__label" htmlFor={fieldId}>
        <span>{props.label}</span>
      </label>
      <input
        className="keepsake__input"
        id={fieldId}
        type="text"
        value={value}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        {...(props.code ? { autoCapitalize: "characters" } : {})}
        disabled={props.busy}
        onChange={(e) => setValue(props.code ? e.target.value.toUpperCase() : e.target.value)}
      />
      <div className="organizer__form-actions">
        <Button type="submit" variant="secondary" icon={<Icon name={props.icon} />} disabled={props.busy || !ready}>
          {props.submit}
        </Button>
        {props.onCancel ? (
          <Button variant="ghost" icon={<Icon name="close" />} onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function heroesCount(n: number): string {
  return n === 0 ? "no heroes yet" : n === 1 ? "1 hero" : `${n} heroes`;
}

function kidsCount(n: number): string {
  return n === 1 ? "1 kid" : `${n} kids`;
}

function ownerName(owner: OrganizerOwner): string {
  const name = owner.email ?? "The grown-up who started it";
  return owner.you ? `${name} (you)` : name;
}
