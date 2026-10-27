# Third-party data flows: who receives what (#525, part of #320)

Dated 2026-10-27. Status: **repository and infrastructure-as-code audit complete; live-stack
verification not done** (see [Open items](#open-items)). This is an engineering inventory, not
legal advice. Nothing here says the service is COPPA compliant.

Treat every recipient below as receiving information from children, because the service is
child-directed for planning purposes (#522).

## How this was produced

Read from the repository at `b460edb`: `infra/template.yaml`, `infra/github-oidc.yaml`,
`scripts/deploy.sh`, `.github/workflows/*`, `packages/server/src`, `packages/client/src`,
`docs/architecture.md` §6, `docs/voice-narration-plan.md`. No AWS API was called. The container
this was written in has no AWS CLI, and the credentials in its environment were not used, because
nobody said they were for inspecting a live stack.

## 1. Runtime model calls: none found in the repository

The claim to test is "the game makes no model call while a table plays"
(`docs/architecture.md` §6, #347). In the repository it holds:

| Check | Result |
| --- | --- |
| Model or speech SDK in `canon`, `client`, `server` or `shared` `package.json` | None. Server dependencies are the AWS SDK for DynamoDB, Lambda and SSM, `web-push`, `aws-jwt-verify`, `express`. |
| A model or generation vendor named in shipped source | None. |
| Bedrock, SageMaker or any model action in `infra/template.yaml` or `infra/github-oidc.yaml` | None. No function role can call a model. |
| `LIVE_LLM_ENABLED` in workflows, infra, scripts | Not in the current tree. A search of this clone's history for that string in `.github`, `infra` and `scripts` also found nothing, so the earlier audit's reading cannot be reproduced from this repository. It may have lived on a branch or in a GitHub environment variable, which is why live verification is still open. |

The invariant is now enforced in CI by `tools/privacy/egress-guard.test.mjs` (runs under
`npm test`). It fails if a shipped package depends on a model or speech SDK, if shipped source or
the stack names a model vendor, if any new literal host appears in shipped source, or if the page
loads a third-party script, stylesheet, font or frame. It was checked to fail on a planted
offender. It is static: it proves what the code can do, not what a deployed stack does.

Not covered by the guard, on purpose: `tools/voice/**` and other offline authoring tools may call
ElevenLabs or Gemini, because they do not ship and never see a table. See §3.

## 2. Processor inventory (as coded)

Region: `us-east-1` (`infra/template.yaml`: the CloudFront certificate must be there and the
stack is single-region). "Contract" means the terms the operator has accepted, which this audit
could not see.

| Recipient | Role | Data it receives | Where in code | Open question |
| --- | --- | --- | --- | --- |
| **AWS CloudFront** | processor | Every visitor's IP address, user agent, requested URL (room code in `/tv/<code>`, `/p/<code>` paths), The application sets no cookies (none in `packages/*/src`). Writes the viewer IP into `x-kad-viewer` for the origin. | `Distribution`, `ViewerAddressFunction` | No access logging is declared in the template. Whether standard or real-time logs were enabled by hand is unknown. |
| **AWS API Gateway (HTTP API)** | processor | All `/api/*` requests: device and session tokens, request bodies (hero name, nickname, actions), source IP. | `HttpApi` | No `AccessLogSettings` declared. Console-enabled logging unknown. |
| **AWS Lambda + CloudWatch Logs** | processor | Request handling, and whatever the code logs. Logs observed in code carry household, run, player and device ids and error objects (`console.error(..., err)`), plus a JSON `client_error` line with browser family, route shape and id. They do not log names or chat by design. | `lambda/*`, `handlers/*` | **Retention is not declared.** The template says an account-wide utility outside this repo sets it. Actual retention of `/aws/lambda/*` for this stack is unverified. |
| **AWS DynamoDB** (`kad-<stage>`, `kad-timing-<stage>`) | processor, system of record | Households, kid profiles and nicknames, heroes, run state, event logs, visits, device bindings, push subscriptions (endpoint and keys), parent email link, wrong-code counters. The wrong-code counter is keyed by the client's IPv4 address or IPv6 /64 with a TTL (`handlers/code-guard.ts`). Timing table holds run id, chapter, timing, no household or player id. | `Table`, `TimingTable` | PITR is off by owner decision. Whether on-demand backups, AWS Backup plans or exports exist in the real account is unverified. Retention is #524. |
| **AWS Cognito** (user pool) | processor | Grown-up email address and the one-time code flow; passkey public credentials. The browser calls `cognito-idp.us-east-1.amazonaws.com` directly. | `UserPool`, `sync/auth.ts` | Cognito's default email sender is used (`COGNITO_DEFAULT`), so email transits AWS-operated mail infrastructure. Pool is retained after stack deletion. Cognito's own logging and retention of sign-in events unverified. |
| **AWS AppSync Events** | processor | Realtime room messages on `room/<code>`: the run-state patches sent to the TV and phones. Whether they carry hero names or nicknames was not traced here; #522 should settle it. Clients connect with a room token. | `EventApi`, `channel/*` | Message content is not retained by the service as far as the template shows, but AppSync logging settings are not declared. Verify. |
| **AWS Systems Manager Parameter Store + KMS (`aws/ssm`)** | processor | Token signing key, push VAPID key pair, CloudFront origin secret. No child data. | `ssm:` resources | None for child data. |
| **AWS EventBridge Scheduler** | processor | The daily sweeper trigger. No child data. | `SweepFunction` | None. |
| **Apple, Google and Mozilla push services** | independent third party (controls its own logs) | Only if `PushNotifications=on`. The subscription endpoint (which identifies the browser or device), the Lambda's IP, timing, and an encrypted payload (RFC 8291) the service cannot read. The cleartext sentence is the fixed `It's your turn in Kids & Dragons`; the room path rides encrypted. The operator's `PushContact` (mailto: or https:) is sent in the VAPID header to every push service. | `web-push.ts`, `handlers/push.ts`, `lambda/push-sender.ts` | Default is **off**. Which stacks have it on is unverified (`KAD_PUSH` is a GitHub environment variable, not in the repo). A device-identifying endpoint tied to a kid's device id is a persistent identifier; see #522. |
| **The visitor's browser vendor** (speech) | independent third party | Possibly the text being read aloud, if the voice chosen is a network voice. See §4. | `speech/synth-speaker.ts` | Unverified. The code comment calls it "free, offline", and nothing in the code enforces offline. |
| **GitHub / GitHub Actions** | operator tooling | Source and build artifacts. No child data reaches it by design. Deploys use OIDC into the AWS role in `infra/github-oidc.yaml`. | `.github/workflows/*` | Confirm no workflow prints live data. None seen. |
| **ElevenLabs, Google (Gemini TTS)** | offline authoring only | Authored story text for the `voice:bakeoff` and the proposed narration pipeline. Not player data. | `tools/voice/**`, `docs/voice-narration-plan.md` | See §3. |

No analytics, advertising, tag-manager, social, font or CDN script is loaded by the page. The
guard test enforces that for `packages/client/index.html`.

## 3. Pre-generated narration (ElevenLabs / Gemini)

This is offline content generation, which is a different thing from runtime inference:

- The bake-off tool reads `ELEVENLABS_API_KEY` / `GEMINI_API_KEY` from the operator's shell and is
  not part of any package that ships (`tools/voice/bakeoff/run.ts`).
- `docs/voice-narration-plan.md` §8 already says lines that contain a player's character name stay
  on the device voice so the name never goes to ElevenLabs or Google, and that a server-side live
  TTS proxy "is a privacy decision first and an engineering one second".

Requirements to adopt as part of this issue, not yet enforced anywhere:

1. The generation pipeline's input is authored `content/` only. Add a test when the pipeline
   exists that fails if any template variable resolved from a player (`{hero}`, `{party}` names,
   nicknames) reaches a provider request.
2. No live player name, text or state goes to a generation provider without a separately reviewed
   legal basis and notice. The guard in §1 already stops a provider SDK or host landing in shipped
   code.
3. Record each provider's data-use terms (training on inputs, retention) for the authored text.
   That text is not personal information, so the risk is IP and cost, not COPPA, but the record
   belongs in the vendor file.

## 4. Browser speech is not necessarily offline

`synth-speaker.ts` calls `window.speechSynthesis` and selects a voice only when one is configured
(`pickVoice`), otherwise leaving the browser's default. It never reads `SpeechSynthesisVoice.localService`.
So:

- On some browsers a default or named voice is a network voice (for example Google's or Microsoft's
  cloud voices in Chrome and Edge). The text of the utterance then goes to that vendor.
- What is spoken can include hero names if the narration substitutes them in (not traced here; `voice-narration-plan.md` §8 assumes it does).
- Do not publish "read-aloud never leaves your device" until this is resolved.

Options for a decision (not made here): (a) prefer or require `localService === true` voices and
fall back to silence or on-screen text when none exists; (b) keep the current behavior and disclose
it in the privacy policy (#523) with the browsers affected; (c) measure it first, by recording
network activity while reading aloud on Chrome, Edge, Safari and Firefox on current OS versions.
Recommendation: (c), then (a). This changes behavior, so it needs the owner's call.

## 5. Data-flow diagram

```
 child's / grown-up's browser (TV, phones, tablet)
   │ HTTPS                                   │ HTTPS direct               │ Web Speech API
   ▼                                         ▼                            ▼
 CloudFront ──► S3 (SPA, art, content)     Cognito (email, OTP,        browser / OS voice
   │  adds x-kad-viewer (IP)               passkey)                    (local or vendor
   ▼                                                                    network voice: ?)
 API Gateway ──► Lambda `api` ──► DynamoDB (game table, timing table)
                   │    │   │
                   │    │   └─ async invoke ─► Lambda `push-sender` ─► Apple / Google / Mozilla
                   │    │                         (only if PushNotifications=on)   push services
                   │    └─ EventPublish ─► AppSync Events `room/<code>` ─► phones, TV
                   └─ SSM (signing key, VAPID keys)

 EventBridge Scheduler ─► Lambda `sweep` ─► DynamoDB

 offline, on an operator's machine only:  content/*.json ─► ElevenLabs / Gemini TTS ─► audio files ─► S3
```

## 6. COPPA third-party disclosure

COPPA treats a service provider that handles personal information only to support the operator's
internal operations differently from disclosure to a third party for that third party's own
purposes. The AWS services above are the first kind **if** the AWS account terms bind AWS to the
operator's instructions (the AWS customer agreement and data processing addendum). The push services
are less clear: they are not bound by anything the operator signed, they see a device-identifying
endpoint, and they log. Whether that is a "disclosure" needing its own parental choice under the
rule is an **unresolved legal question** to take to counsel (see #526). Pushes are off by default,
which is the conservative position until it is settled. Verify the rule text and the FTC FAQ
(https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
against this table; this audit did not do that.

## Open items

These block closing #525 and need a person with access to the real account:

1. **Live stack parameters.** For each of `dev`, `staging`, `prod`: `aws cloudformation
   describe-stacks` parameters (`PushNotifications`, `PushContact`, `SessionTiming`), and the
   GitHub environment variables `KAD_PUSH` and `KAD_PUSH_SUBJECT`. Record the dated values here.
2. **Live permissions.** `aws iam simulate-principal-policy` or a read of the deployed Lambda roles
   for any `bedrock:*`, and the account's model access settings, to confirm no model is reachable
   from the stack. Also check the GitHub deploy role for anything added outside the template.
3. **Logs.** Retention on `/aws/lambda/*` for this stack, any API Gateway or CloudFront access
   logging enabled outside the template, AppSync logging. Fix: declare them in the template once
   decided (retention itself belongs to #524).
4. **Backups.** DynamoDB on-demand backups, AWS Backup plans, exports, and replicas.
5. **Runtime egress test on a deployed stack.** Play a session with a unique hero name and nickname
   and confirm from CloudWatch, CloudTrail and (if available) VPC or proxy evidence that the name
   reaches only the services in §2. The static guard cannot show this.
6. **Browser speech** measurements in §4.
7. **Vendor terms and DPA record**, per row in §2, with links and dates.
8. **Reconcile with #522**: the field-by-field matrix should reference this file for each
   third-party column.
9. **Counsel question** in §6.

## Change log

- 2026-10-27: first version. Added `tools/privacy/egress-guard.test.mjs`.
