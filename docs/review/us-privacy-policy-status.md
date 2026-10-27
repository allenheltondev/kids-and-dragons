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
