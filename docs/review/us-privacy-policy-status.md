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
8. **Link placement.** 16 CFR 312.4(d) (excerpts supplied by the owner's review; the issue #523
   comment of 2026-10-28 quotes "prominent and clearly labeled link" and "in close proximity to the
   requests for information") puts the link where information is requested.
   **Decision 2026-10-28 (owner):** a quiet "Privacy" footer link on every screen that is not the
   game itself and on anywhere a kid can land directly, and not in gameplay. Built:
   the two start screens, a direct room link (which shows the start screen with the code
   filled in), hero creation, the phone's lobby, the adventure book, the account and guide pages,
   and the closed-room and removed-phone screens. It opens `/privacy` in a new tab so a name or
   code already typed is not lost. Not linked: gameplay, and the shared TV screen, which asks
   nobody for anything. Tested end to end from a direct room link (`e2e/privacy-link.spec.ts`).
   The links sit in a full-width page footer strip with the grown-up's guide beside Privacy and a
   "© <year> Ready, Set, Cloud!" line under them (the phone's hero-creation and lobby screens keep
   one line of links, for height). Note: the copyright names Ready, Set, Cloud! while the
   privacy page names the operator as Allen Helton; the notice rule asks for the operator's
   identity, so confirm which legal name should appear on the page (see #526).
   **Still a risk for counsel:** the link is small and quiet by choice. The comment on #523 calls
   for a "prominent and clearly labeled" link and recommends a small link beside each name field;
   whether a quiet footer satisfies that is unanswered, and the fix if it does not is a more
   visible link at the name-entry controls.
9. **Launch blockers this page does not fix.** Publishing `/privacy` is not proof of compliance.
   Still open: the parental consent and collection boundary (#522), verifiable consent and direct
   notice (#523), a procedure for parents to review, delete or stop collection (#523), and an
   enforced retention schedule (#524). 312.10: "Personal information collected online from a child
   may not be retained indefinitely." 312.4(a): "provide notice and obtain verifiable parental consent
   prior to collecting, using, or disclosing personal information from children." (Excerpts as
   supplied by the owner's review.) Exceptions and consent methods still need qualified counsel.
