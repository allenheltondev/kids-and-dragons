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
 *   - **one household**: its kids (add, rename, retire, bring back) with
 *     their heroes, and its organizers (invite one, take one off, leave).
 *
 * Written for the adult holding it, in the plain words the rest of the
 * sign-in flow uses. Kids never see this; they tap their face on a tablet.
 */

import { useId, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { OrganizerHouseholdView, OrganizerOwner, OrganizerPlayer } from "@kad/shared";
import { formatInviteCode, useOrganizerStore } from "../store/organizer";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
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

      <OrganizersSection view={view} busy={busy} />
    </>
  );
}

function PlayerRow({ player, busy }: { player: OrganizerPlayer; busy: boolean }): ReactElement {
  const edit = useOrganizerStore((s) => s.edit);
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
    <li className={`organizer__row${player.retired ? " organizer__row--retired" : ""}`}>
      <span className="keepsake__dot" style={{ background: player.color }} aria-hidden="true" />
      <span className="organizer__who">
        <b>{player.displayName}</b>
        <span className="organizer__heroes kad-muted">
          {player.heroes.length === 0
            ? "No hero yet"
            : player.heroes.map((h) => `${h.name}, level ${h.level}`).join(" · ")}
        </span>
      </span>
      <span className="organizer__row-actions">
        {player.retired ? null : (
          <button type="button" className="organizer__link kad-focusable" onClick={() => setRenaming(true)} disabled={busy}>
            Rename
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

function kidsCount(n: number): string {
  return n === 1 ? "1 kid" : `${n} kids`;
}

function ownerName(owner: OrganizerOwner): string {
  const name = owner.email ?? "The grown-up who started it";
  return owner.you ? `${name} (you)` : name;
}
