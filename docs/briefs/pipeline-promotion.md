# Brief: promote one artifact, and shrink the deploy role

**Status: open.** The 2026-07 pass made the pipelines *correct* — real action
versions, prod gated on CI via `workflow_run` pinned to the CI-tested SHA, a
prod-only strict art gate, post-deploy smoke checks, S3 versioning for
rollback. Two structural things were out of its scope and are worth a
deliberate change. Neither is urgent; both get more expensive to retrofit as
the stack grows.

## 1. Build once, ship twice

Staging builds the PR merge ref; prod rebuilds the main commit. Two `npm ci`
resolutions, two esbuild runs — "it worked on staging" is an inference about a
*different pair of bytes*. The fix:

- `ci.yml` uploads `infra/.build/` + `packages/client/dist/` as an artifact
  named by `${{ github.sha }}` after its build steps.
- `scripts/deploy.sh` learns a ship-only mode (`KAD_ARTIFACT_DIR`, say) that
  skips `infra:build` and `npm run build` and syncs what it is given. The
  build half stays the default so a laptop deploy still works unchanged.
- Both deploy workflows download the CI artifact instead of rebuilding.
  Prod already pins the exact SHA, so the artifact lookup is exact too.

This also deletes two of the four `npm ci` runs a merged PR currently pays,
and makes "roll back" = "re-run the ship phase against an older artifact" —
strictly better than the S3-versioning restore.

## 2. The deploy role is account-admin in a party hat

`infra/github-oidc.yaml` grants `PowerUserAccess` + `IAMFullAccess` to both
roles, and the **staging** role is assumable from a workflow that runs
repository-controlled code on every collaborator PR. Every stack resource is
already name-prefixed (`kad-*`, `!Sub "...${StageName}"`), so a scoped policy
is mechanical: CloudFormation on `kad-*` stacks; S3 on `kad-site-*`;
CloudFront invalidations; DynamoDB/Cognito/AppSync/Lambda/SSM on `kad-*`
names; IAM limited to roles under a `/kad/` path. Do prod first (smaller blast
radius if the policy is too tight — staging failures are cheap to iterate on),
and require a reviewer on the `Staging` environment while iterating.

## 3. Say what staging is

One shared mutable stack, updated in place by every PR, never torn down —
which is fine for a family project, but two open PRs overwrite each other and
a reviewer cannot tell whose bytes are live. Cheapest honest fix: the staging
summary already prints the PR head SHA; add the same line as a sticky PR
comment ("staging is serving `<sha>` as of this run") so the answer is on the
PR that asks. Per-PR stacks are the expensive alternative and are not
justified until two humans review in parallel — note the `Retain` policies on
the table and user pool before ever going there.

## Also, while in there

- `.github/dependabot.yml` with `package-ecosystem: github-actions` — the
  bogus `@v7` pins this pass fixed were hand-guessed upgrades; make them
  mechanical. (`deploy.yml` already carries the dependabot-actor guard.)
- A `requirements-dev.txt` (pillow, numpy, cfn-lint) + `cache: pip`, so the
  three pip installs across the workflows stop re-downloading.
- Consider `workflow_dispatch` input `ref` on the prod workflow for one-click
  deploy of a known-good older commit; with #1 done it becomes "pick an
  artifact" instead.

## Acceptance

A merged PR produces exactly one build, whose digest appears in the staging
summary, the prod summary, and the artifact name; `aws iam simulate-principal-policy`
(or a failed-deploy dry run) shows the prod role cannot touch a non-`kad-*`
resource; the staging PR comment names the live SHA.
