# Privacy policy and notices: status (#523, part of #320)

Dated 2026-10-27. Engineering status, not legal advice.

## Done

- Timing records are described as set to expire after 180 days, with the database's cleanup following
  in the days after, not as deleted on day 180 (DynamoDB TTL is asynchronous). Other TTL rows are
  read-gated (a room past its expiry reads as absent), so only the timing marks carry this lag in the copy.
- Operator identity and contact published on the page (see item 1 under Not done).

- A public `/privacy` page (`screens/PrivacyScreen.tsx`, words in `screens/privacy-policy.ts`),
  linked from the start screens (`HomeScreen`, `SharedHome`) so it can be read before anyone joins
  or hosts. A lazy chunk, so first paint is unchanged.
- It describes what the game does today, from the audits in this folder, and makes no compliance
  claim and no promise of a retention limit that is not enforced.
- Corrected the false statements: "never type anything personal" (`WhatWeStore.tsx`), "only live on
  this phone" and "stay for good" (`SignInFlow.tsx`); said the parent email is held both by Cognito
  and in the household's owner rows; said the request-log and backup periods are unconfirmed.
- `screens/privacy.test.tsx` fails if those claims return, if the page loses a required section,
  or if the route stops resolving.

## Not done

1. **Operator name and contact** (`screens/operator.ts`) are set to Allen Helton and
   allenheltondev@gmail.com, as the owner gave them on 2026-10-27. Confirm this is the address you
   want public, and whether a legal entity should be named instead (#526).
2. **Direct notice and consent.** Nothing asks a parent before a child's first write. This waits
   on the #522 decision (option A, B or C). The page says plainly that no such step exists yet.
3. **Parental access, deletion and revocation procedure.** A signed-in grown-up can delete a kid or
   household in the app. A guest household has no grown-up on record, so the page tells its
   grown-up to sign in to keep it and then delete it. There is no process, and no fulfillment test,
   for a parent who writes in. Needs a decision on what identity checks are reasonable, probably
   with counsel.
4. **Retention wording.** The page says kept households have no automatic end today. When the
   one-year limit in [us-retention-schedule.md](./us-retention-schedule.md) ships, change
   `how-long` in `privacy-policy.ts` and the `UNTIL_DELETED` text in `what-we-store.ts` in the same
   commit, and the test that pins "no automatic end today" will fail until you do.
5. **Browser read-aloud** is described as possibly sending text to the browser's maker, because
   that is unverified (see [us-third-party-flows.md](./us-third-party-flows.md) §4).
6. Review of the page's wording by someone qualified.
7. **Full operator contact.** The notice names the operator and an email only. 16 CFR 312.4(d)(1)
   asks for "The name, address, telephone number, and email address" of operators (excerpt supplied
   by the owner's review of #532, who checked it against the current eCFR; not re-checked by the
   author of this note). Before a public U.S. launch, add suitable *business* contact details to
   `screens/operator.ts` and `PrivacyScreen.tsx`, not a residential address. Until then the page is
   incomplete.
8. **Link proximity.** 312.4(d) says "The link must be in close proximity to the requests for
   information in each such area" (same source). The policy is linked only from the two start
   screens. Children also enter names at a direct room link (`/p/<code>`), the creation flow and a
   family tablet's kid picker, and none links to it. The owner has chosen to keep the link to the
   start screens (see below), so this item is now a question for counsel, not a to-do.
   **Decision 2026-10-27 (owner):** the link is a small, quiet "Privacy" footer at the bottom of
   the start screens, not a visible line among the buttons, because it is there only because it has
   to be. The footer keeps the secondary text colour and a full-height tap target. **Risk to put to
   counsel:** as the author understands the notice rule, the link must also be *clear and
   prominent* (unchecked here; the review's excerpt quotes only the proximity sentence). A small
   footer may not satisfy that for a service aimed at children, and it is not near the places
   children type names. If counsel says it does not, the fix is to make it more visible at those
   places, not to revert this.
   **Scope, 2026-10-27 (owner):** the link lives on the start screens only, not in gameplay,
   hero creation or the room screens. The consequence to put to counsel: a child who arrives by a
   direct room link (`/p/<code>`) or a family tablet's saved page never sees the start screen, so
   reaches name entry with no link at all. Today's other entry points to the policy are the
   "What we store" links in the sign-in panel and the organizer screen.
9. **Launch blockers this page does not fix.** Publishing `/privacy` is not proof of compliance.
   Still open: the parental consent and collection boundary (#522), verifiable consent and direct
   notice (#523), a procedure for parents to review, delete or stop collection (#523), and an
   enforced retention schedule (#524). 312.10: "Personal information collected online from a child
   may not be retained indefinitely." 312.4(a): "provide notice and obtain verifiable parental consent
   prior to collecting, using, or disclosing personal information from children." (Excerpts as
   supplied by the owner's review.) Exceptions and consent methods still need qualified counsel.
