# Privacy policy and notices: status (#523, part of #320)

Dated 2026-10-27. Engineering status, not legal advice.

## Done

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
7. **Full operator contact.** The notice names the operator and an email only. The owner's review
   of #532 cites the FTC COPPA FAQ (C.2, 16 CFR 312.4(d), cited by the reviewer and **not checked
   here**) as also expecting a mailing address and a telephone number. Before a public U.S. launch,
   add suitable *business* contact details to `screens/operator.ts` and `PrivacyScreen.tsx`, not a
   residential address. Until then the page is incomplete.
8. **Link proximity.** The policy is linked only from the two start screens. Children also enter
   names at places that link does not cover: a direct room link (`/p/<code>`), the creation flow
   and a family tablet's kid picker. Per the same review (FTC FAQ C.6, also unchecked here), review
   where a link or notice must sit at every point where a child types a name. Not done.
9. **Launch blockers this page does not fix.** Publishing `/privacy` is not proof of compliance.
   Still open: the parental consent and collection boundary (#522), verifiable consent and direct
   notice (#523), a procedure for parents to review, delete or stop collection (#523), and an
   enforced retention schedule (#524). Retained child data cannot stay indefinite.
