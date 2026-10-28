# U.S. launch privacy readiness (#526, part of #320)

Dated 2026-10-28. An engineering screen and a checklist, **not legal advice**. State children's
privacy law is changing quickly, and the research behind the law matrix below came from secondary
sources (law-firm and advocacy summaries) that disagree with each other on dates and court
status. Every row is a prompt for qualified review, not a conclusion.

## Ship / no-ship

**Recommended: NO-SHIP for external U.S. launch.** The owner has not yet made this decision;
record it in the decision table below. Why:

- The parental consent and collection boundary does not exist (#522, undecided: option A, B or C).
- There is no verifiable consent method, direct notice, or process for a parent to review, delete
  or stop collection (#523).
- The retention schedule is approved but not enforced; kept households still have no automatic
  end (#524).
- No deployed-configuration evidence exists (#525): no live stack parameters, IAM, log retention,
  backups or runtime egress.
- The legal questions below have not been put to counsel or a safe-harbor program.

Private use by the owner's own family is a different question and is not what this document
screens.

## What the service is, in the terms the laws use

Read from the code and docs; each point is checked against a file.

- **Audience:** a family game for children around eight, played at a shared screen with a grown-up
  reading. Treated as **child-directed** for planning (#522).
- **Accounts:** none for kids. A grown-up may sign in by email to keep a household.
- **What is shown to other people:** a seated player's nickname, color and avatar, and hero name,
  to the people at the same table (the TV and the other phones). There is no profile page that
  strangers can browse: a kid's "flair" page is shown only to her own household and devices
  (`PlayerProfile.flair`).
- **Posting:** there is **no free chat** and no user-posted content feed. Typed text is limited to
  the nickname, the hero name and a table name. Spectators can "cheer", chosen from a **fixed list
  of five pictures** (`shared/src/spectators.ts`), so nothing a spectator types reaches the TV.
- **Strangers:** a room can be **open to visitors** from other households. A visitor needs the
  room's six-letter code, and an idle open room closes itself after 30 minutes
  (`shared/src/visitors.ts`). Four-letter codes are rate-limited per client address.
- **Advertising, tracking, sale:** none. No third-party scripts load (`tools/privacy`
  guard test).
- **Geography:** see the next section.

## "U.S.-only" is an intent, not a control

Nothing in the deployment limits who can reach the game by country or state:
`infra/template.yaml` has no CloudFront geo restriction. Its `PriceClass_100` only chooses which
edge locations serve it, which is a cost setting, not an access rule. So anyone anywhere can load
the site and play. Consequences:

- The privacy page and any marketing **must not say** the service is "only available in the U.S."
  or "not for use elsewhere". It would be untrue today.
- Laws outside the U.S. (the EU/UK GDPR and children's codes, Canada, Australia and others) are
  **not screened here** and could apply to families who reach the game. #320 treats outside-U.S.
  use as a separate gate (#525 is P0 "before outside U.S. families use the affected features").
- An actual restriction is possible (a CloudFront geo allow-list for the U.S.), but it would not
  tell states apart, would not stop a VPN, and is a product decision that also blocks U.S.
  families traveling. Decision pending.

## Applicable-law matrix

"Likely applies" means the service's facts appear to meet the law's description, to be confirmed.
"Threshold" means the law only reaches businesses above a size or data-volume line the operator
may be under at launch, which can change. Statuses come from the sources listed at the end and
conflict in places; **check each statute and docket before relying on any date**.

| Law | What it covers | Screen for this service | Next step |
| --- | --- | --- | --- |
| **COPPA, 16 CFR Part 312**, with the 2025 amendments (compliance deadline reported as 2026-04-22) | Online collection of personal information from children under 13 by a child-directed service | **Likely applies.** This is the main gate: #522 to #524. | Counsel; consent design (#522) |
| **FTC Act section 5 and state unfair/deceptive practices laws** | Public statements about privacy must be true | **Applies to every operator.** The page now avoids absolute claims and compliance claims; keep it that way. | Keep the privacy-page copy tests; re-review on each change |
| **Texas SCOPE Act (HB 18)** | "Digital service providers" with social interaction, a public or semi-public profile, and user-posted content; minors under 18 | **Probably outside the definition, not proven.** See the element analysis below. Reported partly enjoined; sources conflict on the 2026 appellate outcome. | Counsel; read the current text and Fifth Circuit opinion |
| **New York Child Data Protection Act** (reported effective June 2025) | Operators of sites and apps primarily directed to minors, or with knowledge of minor users; users under 18; collection and use generally limited to what is "strictly necessary" or consented to; written agreements with processors | **Likely applies.** Reported as covering under-18s, wider than COPPA. **Whether it has a size threshold was not confirmed by the sources read; check.** Reads as the most relevant state law found. | Counsel; map "strictly necessary" against each stored field (#522) |
| **State comprehensive privacy laws** (about 20 states; Virginia, Connecticut, Colorado, Oregon, Montana, Texas and others) | Personal data of consumers; most set revenue or volume thresholds; many treat a known child's data as sensitive and require COPPA-style parental consent; several added minors (13 to 17) rules in 2025 and 2026 | **Threshold for most, but not all.** At small scale the operator is probably under the usual thresholds; some laws may reach small operators (the author recalls Texas's law has no volume threshold beyond a small-business exemption; **unchecked, and not in the sources read**). Check each. Monitor user counts by state. | Counsel; count users by state once launched |
| **California: CCPA/CPRA** | Businesses over a revenue or data-volume line | **Threshold.** Probably under at launch. | Monitor |
| **California Age-Appropriate Design Code** | Online services "likely to be accessed by children"; reported mostly enjoined (Ninth Circuit, March 2026) with parts allowed to proceed | **Threshold and in litigation.** | Monitor |
| **California "online eraser" law for minors** | Operators of sites directed to minors; lets registered minors remove content they posted | **Marginal.** Kids have no accounts and post no content; a nickname is not a post. | Counsel to confirm |
| **Other design-code laws** (Maryland, Vermont reported 2027-01-01, Nebraska, South Carolina) | Covered entities above thresholds; duty-of-care or impact-assessment duties; some challenged by NetChoice | **Threshold; dates conflict.** | Monitor |
| **App-store accountability laws** (Utah, Texas, Louisiana, Alabama and others; dates and injunctions reported to differ) | App stores, and developers distributed through them | **Not today.** The game is a web app, not in an app store. Reassess if it ships in one. | Reassess on app-store release |
| **Social-media minor-access and age-verification laws** (Florida, Utah, Arkansas, Louisiana and others) | "Social media platforms" | **Likely not.** No profiles, feed or messaging. | Counsel to confirm with the SCOPE analysis |
| **Data-breach notification laws (all states)** | Notify after unauthorized access to listed personal information | **Applies to the extent the service holds it.** The grown-up email is the main item. No incident process is written. | Write an incident-response note (new item) |
| **Email law (CAN-SPAM) and state equivalents** | Commercial email | **Not applicable.** The only email is the sign-in code, sent by Cognito. A pre-deletion email was declined. | None |
| **Biometric laws (Illinois BIPA and others)** | Biometric identifiers | **Not applicable.** Passkeys are handled by the browser and Cognito; the service holds no biometric data. | None |
| **State AI/chatbot laws** | Operators of AI chat features | **Not applicable.** No model runs at play time (guard test in `tools/privacy`). | Keep the guard |

## Texas SCOPE Act: element by element

The issue asks for a determination from the definitions, not a categorical assumption either way.
As reported by secondary sources, a "digital service provider" is a service that lets users
**(1)** interact socially with others, **(2)** keep a public or semi-public profile, and **(3)**
post content that others can view. Against this service:

1. **Interact socially.** Players play together at a table and a spectator can cheer. This element
   is plausibly met in the ordinary sense. *Unresolved: whether co-playing a game counts.*
2. **Public or semi-public profile.** There is no profile page others can browse. A seat shows
   nickname, color and avatar to the people in that room. Rooms are private by default; an *open*
   room admits other households' phones that hold a six-letter code and closes after 30 idle
   minutes. *Unresolved: whether a seat shown to a room of strangers with the code is "semi-public".*
3. **Post content others can view.** There is no chat or feed. Typed text is a nickname, a hero
   name and a table name, each shown to the room. Cheers come from a fixed list. *Unresolved:
   whether a typed name shown at a table is "posted content".* This is the element most worth
   closing: with generated or picked names (option B in #522) the answer becomes much clearer.

**Screen result: probably not a "digital service provider", with element 3 the weakest point
and open rooms the second.** That could change if chat, a gallery, profiles or public rooms are
ever added. Record it as a design constraint: no free chat, no public profile, no public room
list, without a new review.

## Questions for children's-privacy counsel or a safe-harbor program

1. Does a typed nickname, hero name or table name count as personal information for a service whose
   users cannot create accounts, given that the filter checks profanity and not personal details?
2. Does the internal-operations exception cover a device-bound persistent hero and party record?
   (#522)
3. Which consent method fits a game played at a shared screen, where the first person to touch it
   may be a child?
4. Are the push services, and a browser's network read-aloud voices, "disclosures" needing their
   own parental choice? (#525)
5. Is the New York Child Data Protection Act's "strictly necessary" standard met by the current
   stored fields, and are written agreements with AWS enough for its processor rule?
6. Does a small "Privacy" footer link on the start screens satisfy the "clear and prominent" and
   proximity requirements, given that children also type names on a direct room link and in
   hero creation, which have no link? (#523)
7. What identity and authority checks are reasonable for a parent's access, deletion or
   revocation request, given guest households have no grown-up on record? (#523)
8. Is a recognized safe-harbor program worth joining before launch?
9. Should the service block non-U.S. access, and which non-U.S. laws apply to those who reach it
   anyway?

## Completed and open #320 follow-ups

| Issue | State | Link |
| --- | --- | --- |
| #522 consent boundary | Inventory and options written; **no decision, no boundary, no tests** | [us-coppa-data-consent.md](./us-coppa-data-consent.md) |
| #523 policy and notices | Public `/privacy` page, false claims fixed, copy tests; **no consent or direct notice, no parental-request process, no business address or phone** | [us-privacy-policy-status.md](./us-privacy-policy-status.md) |
| #524 retention | Schedule approved in part; **nothing enforced** | [us-retention-schedule.md](./us-retention-schedule.md) |
| #525 third-party flows | Repo and infrastructure audit and a static guard test; **no live-account evidence** | [us-third-party-flows.md](./us-third-party-flows.md) |
| #526 this file | Law screen and checklist written; **no ship decision** | this file |

## Dated operator decisions so far

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-27 | Kept households to be deleted 365 days after anyone last played; owner may shorten; no "never". Not yet enforced. | Owner |
| 2026-10-27 | Trim finished runs' event logs 30 days after the run ends, after checking what reads them. Not yet built. | Owner |
| 2026-10-27 | No warning email before deletion for now. | Owner |
| 2026-10-27 | Operator contact on the privacy page: allenheltondev@gmail.com. Business address and phone still owed. | Owner |
| 2026-10-28 | Operator named on the privacy page as Ready, Set, Cloud! (previously Allen Helton); also the footer's copyright holder. Legal form of the entity to confirm. | Owner |
| 2026-10-27 | Privacy link is a small "Privacy" footer on the two start screens only; none in gameplay. Risk recorded for counsel. | Owner |
| 2026-10-28 | Widened: the same quiet link on every screen that is not gameplay and anywhere a kid can land directly (direct room link, hero creation, lobby, adventure book, account and guide pages, closed/removed screens). None in gameplay or on the TV. Prominence risk still for counsel. | Owner |
| 2026-10-28 | Consent path (A, B or C), geo restriction, and ship/no-ship: **undecided.** | Owner to decide |

## Evidence of deployed configuration

None gathered. The checks in [us-third-party-flows.md](./us-third-party-flows.md) "Open items"
need someone with access to the real AWS account: stack parameters for each stage, IAM roles,
log-group retention, backups and exports, and a runtime egress test. Until they exist, nothing
here states what production does.

## Open risks (not exhaustive)

- Children's data is collected today before any parental consent step.
- Kept households have no enforced end, which the retention rule forbids.
- The privacy page is truthful about those gaps, but disclosure is not compliance.
- The service is reachable worldwide and is not screened outside the U.S.
- The state-law research is secondary and partly contradictory; statutes and dockets were not read.
- No incident-response or breach-notification process is written.
- The operator is named on a public page with no business address or phone, a personal Gmail as the contact, and an unconfirmed legal form.

## What would close #320

1. Owner decisions: consent path, geography, and the open product choices above.
2. Build #522 (boundary and tests), #524 (retention enforcement and deletion tests) and the #523
   parental-request process.
3. Gather the live evidence for #525.
4. Counsel or a safe-harbor review of the questions above and of the privacy page.
5. Then, and only then, update the ship decision in this file with the evidence behind it.

## Sources for the law screen

Search results of 2026-10-28; secondary, conflicting in places, and not a substitute for the
statutes. Listed so the next reviewer can start from the same place.

- Texas SCOPE Act: [Orrick, Texas](https://onlinesafety.orrick.com/texas/);
  [Texas Policy Research on the injunction](https://www.texaspolicyresearch.com/texas-scope-act-blocked-federal-court-grants-injunction-as-legal-saga-continues/);
  [bill text, HB 18](https://legiscan.com/TX/text/HB18/id/2820309);
  [Texas AG, as named in #526](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/securing-children-online-through-parental-empowerment).
  The sources disagree on the July 2026 Fifth Circuit result and on whether a private action
  exists. Read the opinion and the statute.
- State privacy laws with minors' rules:
  [Taft bulletin](https://www.taftlaw.com/news-events/law-bulletins/childrens-privacy-law-update-new-laws-regulate-how-companies-interact-with-childrens-data/);
  [Troutman state charts, January 2026](https://www.troutmanprivacy.com/wp-content/uploads/sites/941/2026/02/US-State-Children-and-Teens-Data-Privacy-Charts.pdf);
  [Privacy World, August 2026](https://www.privacyworld.blog/2026/08/adding-to-the-count-the-latest-in-state-consumer-privacy-laws/).
  Dates for Vermont and Louisiana conflict between sources.
- Design codes and litigation:
  [Loeb, June 2026](https://www.loeb.com/en/insights/publications/2026/06/childrens-online-privacy-2026-state-app-store-design-code-and-social-media-laws);
  [Cooley on NetChoice v. Bonta](https://www.cooley.com/news/insight/2026/2026-03-30-netchoice-v-bonta-ninth-circuit-narrows-injunction-against-californias-ageappropriate-design-code-act).
- New York: [Goodwin](https://www.goodwinlaw.com/en/insights/publications/2025/06/alerts-practices-dpc-new-yorks-child-data-protection-act-now-effect);
  [Mondaq](https://www.mondaq.com/unitedstates/privacy-protection/1642602/new-yorks-child-data-protection-act-is-now-in-effect-what-you-need-to-do).
  The effective date is reported as June 20 or July 1, 2025.
- COPPA: the FTC pages linked in #522 and #526, and the rule excerpts recorded in
  [us-privacy-policy-status.md](./us-privacy-policy-status.md).
