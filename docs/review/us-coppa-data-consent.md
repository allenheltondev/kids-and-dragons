# COPPA: child data inventory and consent boundary (#522, part of #320)

Dated 2026-10-27. Status: **draft inventory complete from the code; no launch decision made; no
consent or boundary tests yet.** This is an engineering document, not legal advice, and nothing
in it says the service is compliant. The service is treated as child-directed for planning.

Third-party recipients for each row are in [us-third-party-flows.md](./us-third-party-flows.md).

## Unresolved legal assumptions (read first)

1. **Most rule citations are unverified.** The owner's review of #532 supplied short excerpts of
   16 CFR 312.4(a), 312.4(d) and 312.10, checked against the eCFR as of 2026-10-23; those are
   reflected in [us-privacy-policy-status.md](./us-privacy-policy-status.md). Everything else here is
   still unchecked. The eCFR (`www.ecfr.gov`) is not reachable from the session
   that wrote this, so no rule text was read. Section numbers below come from the structure of
   16 CFR Part 312 as the author knows it and from the FTC pages linked in #522. The rule was
   amended in 2025; sections may have been renumbered or reworded. **Every citation must be
   checked against the current text before this document is relied on.**
2. Whether a typed nickname, a hero name or a table name is "personal information". The rule's
   definition reaches persistent identifiers and names. Because the name filter checks profanity,
   not personal information (`packages/shared/src/names.ts`), a child can type a real first and
   last name, a school or a street into any of them, and the server stores it.
3. Whether the **internal-operations exception** can cover a persistent hero and party state
   (see [The exception question](#the-internal-operations-exception-question)).
4. Whether push services and browser voices are "disclosures" (see the third-party file).
5. Whether the operator is an entity that can rely on a school or other intermediary: assumed
   **no**. The operator is the only collector.

## Where collection first happens

Order a brand-new visitor meets the system, earliest first. Anything above the line happens with
no action by the child or a grown-up beyond opening the page.

| # | Point | What is collected | Written durably? |
| --- | --- | --- | --- |
| 1 | Page load (`CloudFront`, S3) | IP address, user agent, URL. The API path also gets the IP in `x-kad-viewer`. | Not by the application. Provider logging unverified (third-party file). |
| 2 | `GET /api/config`, content and art fetches | Nothing the application keeps. | No |
| — | **Nothing written by the app so far** | | |
| 3 | A wrong room code (`GET /api/state`, join, watch) | Client address (IPv4, or IPv6 /64) in a counter row `GUESS#<client>`, with a TTL. Written before any household exists. | Yes (short TTL) |
| 4 | `POST /api/client-error` | A scrubbed crash report: kind of failure, route shape, browser family, build, page id. No message text. Written to logs. | Logs |
| 5 | **`POST /api/room`** (a TV or a host phone opens a room) | Creates a guest **household**, a **player profile** (the host's typed or generated nickname, default "Host"), a **device binding with the user agent**, a **device token**, a room and a run. A TV also may send a **table name** (`location`). First durable child-linked write. | Yes |
| 6 | **`POST /api/room/<code>/join`** (a phone joins) | A new guest household or a new profile under the table's household, with a **nickname typed or generated on the phone**, the user agent and a device token. | Yes |
| 7 | Hero creation | **Hero name** (free text), species, appearance. | Yes |
| 8 | Every action in a game | Choices and dice rolls in the event log, run state, presence beats, field guide finds. | Yes |
| 9 | Optional: grown-up signs in | Email address and one-time code, at Cognito. | Yes (Cognito) |
| 10 | Optional: push switch | Push subscription endpoint and keys, tied to a kid's device. | Yes |

The earliest **application** write is #3 or #5, and #5 is the first one that stores something a
child may have typed. A grown-up may be the one operating the TV at #5, but nothing in the code
establishes who is typing: the host phone path takes the same fields. **The consent boundary
therefore has to sit in front of #5 and #6**, unless the data they store is reduced to what a
documented exception covers.

There is no age or birthdate field anywhere, and this document recommends **not adding one**
(#522). There is no camera, microphone, geolocation or contacts access in the client, and no free
chat between players (searched `packages/client/src`).

## Field-by-field matrix

"Collector" is always the operator. "PI?" is the working classification, **unverified** (see
assumption 2). "Basis" is the proposed exception or consent basis, **not yet decided**.

| Field | Where it enters | Purpose | Stored in | Third parties | Retention today | PI? | Proposed basis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IP address (CloudFront) | page load | delivery, abuse | provider logs (unverified) | AWS | unverified | Yes, persistent identifier | internal operations: security |
| IP / IPv6 /64 in `GUESS#` | wrong room code | stop code guessing | DynamoDB | AWS | ~30 minutes (TTL) | Yes | internal operations: security |
| User agent on device binding | #5, #6 | let a grown-up tell tablets apart | DynamoDB `DEVICE#` | AWS | with the household | Likely not alone; identifier combined | candidate to **stop storing** for visitors |
| Device id and token | #5, #6 | recognize the same phone | DynamoDB (hash), browser storage | AWS | with the household | Yes, persistent identifier | internal operations: authentication |
| Nickname (`displayName`) | #5, #6 | show who is who at the table | DynamoDB `PLAYER#`, `RoomSeat`, run state, event log | AWS; shown on the TV | with the household | **Possibly**: free text, profanity filter only | candidate: generate from a fixed list, no free text |
| Household name (`"<nickname>'s household"`) | derived at #5 | label | DynamoDB | AWS | with the household | Same as nickname | follows nickname |
| Table name (`location`) | #5, TV | label the evening | run record | AWS | with the run | **Possibly**: free text | candidate: pick from a list or drop |
| Hero name | #7 | the hero's identity | DynamoDB `CHAR#`, saves, event log | AWS; maybe browser voice | with the household | **Possibly**: free text | candidate: generate or pick |
| Species, appearance, class, items | #7, #8 | gameplay | DynamoDB | AWS | with the household | Not by itself | n/a |
| Event log, run state, chapters, coins | #8 | gameplay, catch-up after a drop | DynamoDB `RUN#` | AWS | until household deleted | Becomes a profile once linked to an identifier | open: see exception question |
| Presence beats | #8 | wait for a phone | DynamoDB `PRESENCE` | AWS | 6 hours | Linked to player id | internal operations |
| Visits | #6, #8 | find a kid's saves at other tables for deletion | DynamoDB `VISIT#` | AWS | until deleted | Linked to player id | internal operations: compliance |
| Forget job | on delete | finish a deletion | DynamoDB `FORGET#` | AWS | until done | Holds nickname and hero names | legal compliance |
| Field guide entries | #8 | household collection | DynamoDB | AWS | with the household | Linked by id | n/a |
| Profile flair (colors, frames, title) | kid's own page | cosmetics | DynamoDB | AWS | with the profile | Preset values only | n/a |
| Session timing marks | #8 | operator timing | `kad-timing` table | AWS | 180 days (TTL) | Run id only, no player id | internal operations: analytics of operations; **review**: a run id is a persistent identifier within a sitting |
| Parent email | #9 | sign-in | Cognito, owner rows | AWS | until deleted | Yes (a parent's, not a child's) | parent contact for consent, if used |
| Push endpoint and keys | #10 | "it's your turn" | DynamoDB `PUSH#` | Apple, Google, Mozilla | until switched off | Yes, device identifier | needs decision; **off by default** |
| Crash report | #4 | fix bugs | logs | AWS | unverified | No by design | internal operations |
| Local preferences (accessibility, read-aloud, folds) | browser | settings | localStorage | none | on device | No | n/a |
| Saved journal / keepsakes | browser | offline book | IndexedDB | none | on device | Hero names may appear | n/a; stays on device |

## The internal-operations exception question

As the author understands the rule, a persistent identifier may be collected without parental
consent when it is used only to support the service's internal operations and nothing else
personal is collected with it, and the operator must not use it to contact a child, build a profile
for other purposes or serve behavioral ads. **This needs verification against the current text,
including the 2025 amendments.**

Applied to this system:

- **Fits, plausibly:** the device token as authentication, short-lived presence and room rows, the
  wrong-code counter as security, and a rotating crash id.
- **Does not clearly fit:** an open-ended hero and party record kept across sittings and tied to a
  device token. It is a durable profile of a child's play. It might be argued as personalization
  or maintaining state the child asked for, but the exception is written around an identifier
  alone, and this stores much more. Treat it as **not covered** until counsel says otherwise.
- **Does not fit:** any free-text field a child can type, because it can hold a real name or
  contact detail and the filter does not look for those.
- **Needs deciding:** the user agent. It is a descriptive device string kept so a grown-up can
  tell tablets apart; a visitor phone has no grown-up looking at it.

So the exception can plausibly support a **narrow anonymous mode**, and cannot support the game
as it is built today.

## Options

**A. Verifiable parental consent before the first write.** A grown-up consents on the device
before #5 or #6, with a rule-recognized method, a direct notice (#523), a receipt and a
revoke path. A Cognito email code proves access to an inbox, not that the person is a parent, so
it is not enough by itself (#522). Cost: a consent gate in front of every first-time table, a
paid or involved verification method, and a visiting child at someone else's table needs the
host household's consent plus their own parent's. Heaviest to build and operate.

**B. Narrower anonymous mode (recommended starting point, pending your decision).** Until a
grown-up consents, collect only what a documented exception covers:

- Nicknames and hero names come from the existing generated lists (`randomName`,
  `randomNames`), with **no free-text entry**; table name dropped or picked from a list.
- No user agent stored for visitors; IP only for the short security counter.
- No cross-sitting profile: a guest household's state lasts the sitting, with a short, documented
  expiry (the current seven days is a product number nobody has justified; see #524).
- Anything persistent (a kept household, typed names, push, sign-in) requires option A first.

Cost: free-text names are a real part of the fun; hero continuity across weeks needs consent.

**C. Block outright** until counsel signs off. Always available, and the conservative fallback.

Recommendation: **B for the first U.S. launch, A for kept households**, with C if the
unresolved questions above cannot be answered. This is a product decision; none of it is built.

## Tests that must exist before "done"

Not written. Written only after the path is chosen, because they would assert it:

1. A fresh visitor opening the page, then `/api/config` and static assets, writes no row.
2. `POST /api/room` and `POST /api/room/<code>/join` with free text under mode B ignore the text
   and store only a generated name; the user agent is not stored.
3. Under option A, the same calls without a valid, unrevoked consent record are refused before
   any write.
4. Revoking consent deletes or stops collection for the household (cross-checked with #524).
5. A visiting child's join is refused or restricted without the host household's consent.
6. A schema test that fails when a new stored field is added to `PlayerProfile`, `Character`,
   `Household` or a binding without an entry in this matrix (the existing
   `what-we-store.test.ts` already does this for the public page and could be extended).

## Decision record

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-27 | Pending. Recommendation above. | Owner to decide |

## Next steps

1. Allow `www.ecfr.gov` (and `www.ftc.gov`) in the session's network settings, or check the
   citations by hand, and replace the "unverified" flags.
2. Owner picks A, B or C. Then build the boundary and the tests above.
3. Take assumptions 2 to 4 to children's-privacy counsel or a safe-harbor program (#526).
