# Deploying Data Dumpster to production

Assumes you are comfortable with Vercel, Postgres and a terminal and have never
seen this repository.

Read "docs/DATA-ACCESS.md" before promising competitor coverage for Facebook,
TikTok or LinkedIn. Coverage depends on approved purchased-data vendors and
carries platform-specific cost, completeness and legal constraints.

`docs/OWNED-DATA-ISOLATION.md` is a release gate. Public-source containment,
global identity and landscape demand are implemented, but legacy pooled history
has not been cleared of possible owner-derived values and the owned-native
stream is not isolated. Until the remaining design and acceptance suite are
complete, operate one organization only and do not enable owned-native fields
on pooled channels.

---

## 0. Prerequisites

- Node 20 or newer locally.
- A Vercel account with the ability to create a project and add a Postgres
  integration.
- The repository pushed to GitHub, GitLab or Bitbucket.
- openssl, which ships with macOS and every Linux distribution.

**A local gotcha specific to this machine.** The shell exports
NODE_ENV=production, which makes npm silently skip devDependencies, which breaks
tsx and drizzle-kit in confusing ways. Prefix every npm command:

    NODE_ENV=development npm install

---

## 1. Create the database

Vercel dashboard, Storage, Create Database, Neon, Postgres. Pick the region
closest to where the app will run, which for a Boston deployment means iad1 or
cle1. Attach it to the project you are about to create; Vercel then injects
DATABASE_URL and POSTGRES_URL automatically.

**Use the pooled connection string.** Data Dumpster uses the Neon serverless HTTP
driver ("src/db/index.ts"), which opens a connection per statement. The unpooled
string will exhaust connections under cron load. The pooled host has "-pooler" in
it.

Any Postgres 15 or newer works. If you use one that is not Neon, set DATABASE_URL
yourself and be aware that the HTTP driver's lack of multi-statement transactions
is designed around in "src/lib/adapters/runner.ts", so a different driver is a
code change, not a config change.

---

## 2. Generate the secrets

Three are required. Run these and keep the output somewhere safe.

    openssl rand -base64 48    # ENCRYPTION_KEY
    openssl rand -base64 32    # AUTH_SECRET
    openssl rand -hex 32       # CRON_SECRET

**ENCRYPTION_KEY** derives an AES-256-GCM key via scrypt and encrypts every
platform token and model API key at rest ("src/lib/crypto.ts"). It must be at
least 32 characters or the app throws with an explanatory message. **Rotating it
orphans every stored secret.** Ciphertext is versioned with a "v1." prefix, so a
future rotation path is possible, but there is no re-encryption tool today. If
you rotate it, expect to re-enter every credential in Settings.

**AUTH_SECRET** signs Auth.js session JWTs. Rotating it signs everyone out.

**CRON_SECRET** is the bearer token the scheduled endpoints require. The check in
"src/app/api/_lib/cron.ts" hashes both sides to 32 bytes and compares in constant
time, and **fails closed when CRON_SECRET is unset**, so leaving it out disables
scheduled jobs rather than opening them.

---

## 3. Set the environment variables

Vercel, project Settings, Environment Variables. Set these for Production and
Preview both, unless noted.

### Required

| Variable | Value |
|---|---|
| DATABASE_URL | Injected by the Neon integration. Verify it is the pooled string |
| ENCRYPTION_KEY | From step 2 |
| AUTH_SECRET | From step 2 |
| CRON_SECRET | From step 2. Production only |

### Seeding, one-shot

Supply these only to the seed process in step 5. Do not persist the initial
password in Vercel or `.env.local`.

| Variable | Value |
|---|---|
| SEED_ADMIN_EMAIL | The first login |
| SEED_ADMIN_PASSWORD | A real password supplied through a non-echoing secret read |

### Data sources, all optional

Pooled collection and public profile resolution use only an explicit allowlist
of deployment environment sources. Stored per-organization credentials and
owner/admin environment tokens never feed shared rows. They may still be saved
or health-checked, but owned-native collection is disabled until
`docs/OWNED-DATA-ISOLATION.md` provides verified bindings and private storage.

| Variable | Notes |
|---|---|
| YOUTUBE_API_KEY | Free. console.cloud.google.com, create a project, enable YouTube Data API v3, create an API key. Ten minutes. 10,000 units a day |
| ENSEMBLEDATA_TOKEN | Reddit publisher-user source, X profile-onboarding helper, and no-Bright fallback for Instagram, TikTok, Threads and X. It is never used after a Bright Data paid stage starts or fails. Enabling it consumes vendor units; confirm the Reddit commercial-use terms are covered before collecting Reddit data |
| BRIGHTDATA_API_KEY | Primary purchased public source for Facebook, Instagram, TikTok, X, Threads and LinkedIn. Enable only after the vendor-spend and legal decision |
| TWITTER_BEARER_TOKEN | Retained for a future owned-account X path. It is excluded from pooled work and must not be enabled for collection until verified bindings and private storage ship |
| BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD | Retained legacy settings only. Pooled Bluesky deliberately uses the unauthenticated public appview and ignores these values |
| META_ACCESS_TOKEN, META_APP_ID, META_APP_SECRET, META_IG_USER_ID | Owner/Business Discovery configuration retained for future private collection and health checks. Excluded from pooled work today |
| TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN | Owner OAuth retained for future private collection. Excluded from pooled work today |
| LINKEDIN_ACCESS_TOKEN | Retained owner/admin configuration only. It is excluded from pooled work until owned insights have organization-private storage; public LinkedIn collection uses BRIGHTDATA_API_KEY |

Weekly Report Web Search is a separate, owned first-party connection. Prefer a
Google service account: grant its `client_email` read access to both Search
Console properties, then configure the complete JSON credential. OAuth refresh
credentials are supported when service accounts are not allowed.

| Variable | Notes |
|---|---|
| GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON | Preferred. Complete service-account JSON, stored only as a deployment secret |
| GOOGLE_SEARCH_CONSOLE_CLIENT_ID, GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET, GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN | Alternative OAuth connection; all three are required together |
| GOOGLE_SEARCH_CONSOLE_GLOBE_SITE | Exact Search Console property, such as `sc-domain:bostonglobe.com` or the registered URL-prefix property |
| GOOGLE_SEARCH_CONSOLE_BOSTON_SITE | Exact Search Console property for Boston.com |

Source policy is part of deployment approval:

| Platform | Production path | Required decision |
|---|---|---|
| Bluesky | Public AT Protocol | None beyond normal security review |
| YouTube | Official Data API v3 | Configure quota-limited API key |
| Facebook | Bright Data for existing pooled profiles | New profile onboarding is temporarily disabled; approve purchased collection and treat capped snapshots as incomplete. Meta owner/PPCA credentials are excluded |
| Instagram | Bright Data; EnsembleData only without it | Approve purchased collection and its retention/provenance terms. Meta owner/Business Discovery credentials are excluded |
| TikTok | Bright Data; EnsembleData only without it | Legal approval required because the sanctioned Research API does not permit this commercial use. Owner OAuth is excluded |
| X | Bright Data collection; EnsembleData onboarding/no-Bright fallback | Accept source limits and vendor terms. Owner Bearer tokens are excluded |
| Threads | Bright Data; EnsembleData only without it | Legal/procurement approval for purchased competitor collection |
| Reddit | EnsembleData user feeds | Confirm the vendor contract covers commercial Reddit use |
| LinkedIn | Bright Data company + company-post datasets | Accept that public likes/comments/followers are available but views, shares, saves, reach, impressions and certified historical exhaustion are not; owned support waits for private storage |

RSS is retired and must not be enabled.

### Model, optional

Configure connections in Settings, Models instead. These are a fallback default.

| Variable | Notes |
|---|---|
| DEFAULT_MODEL_PROVIDER | One of anthropic, openai, google, azure_openai, openai_compatible, ollama. Bedrock is listed in the internal type but is not implemented; use an OpenAI-compatible Bedrock gateway instead |
| DEFAULT_MODEL | Free text model id |
| DEFAULT_MODEL_MAX_TOKENS | Maximum response tokens for the environment fallback. Defaults to 4096 |
| ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY | Whichever matches the hosted provider |
| AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT | Required together for Azure OpenAI |
| OPENAI_COMPATIBLE_API_KEY, OPENAI_COMPATIBLE_BASE_URL | Required for a compatible gateway. The API key may be omitted only when the endpoint itself accepts the OpenAI key fallback |
| OLLAMA_BASE_URL | Local Ollama server, commonly `http://localhost:11434`; no API key required |
| MODEL_BASE_URL | Optional generic base-URL override. Prefer the provider-specific variable where one exists |

### Delivery, optional

| Variable | Notes |
|---|---|
| SLACK_WEBHOOK_URL | Optional scheduled-report webhook |
| REPORT_SLACK_ORG_ID | Required with Slack report delivery. Must equal the one org allowed to use the global webhook; missing or mismatched values fail closed |
| RESEND_API_KEY | Enables scheduled report email through the Resend HTTPS API |
| REPORT_FROM_EMAIL | Verified sender, for example `Data Dumpster <reports@example.com>` |
| APP_URL | Canonical production origin used for authenticated Slack export links |

---

## 4. Apply the schema, then deploy

Import the repository in Vercel and configure its environment, but do not
promote application code that reads new columns yet. The build runs
`next build` and the repository must pass strict typechecking before release.

The schema is not changed by the build. Against an existing predecessor
environment, audit pooled identities and then apply the reviewed migrations
before deploying application code that reads new columns:

    cd /path/to/pressbox
    NODE_ENV=development npm ci --include=dev
    read -r -s DATA_DUMPSTER_DATABASE_URL
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" NODE_ENV=development npm run db:audit-channel-identities
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" NODE_ENV=development npm run db:migrate
    unset DATA_DUMPSTER_DATABASE_URL

Paste the pooled production URL into the silent `read`. This scopes it to the
current shell and does not write or overwrite `.env.local`. Prefer your secret
manager's equivalent injection in automation.

For a brand-new empty database, create the full current schema, then run the
idempotent migration baselines so Drizzle records them before later changes:

    read -r -s DATA_DUMPSTER_DATABASE_URL
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" NODE_ENV=development npm run db:push -- --force
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" NODE_ENV=development npm run db:migrate
    unset DATA_DUMPSTER_DATABASE_URL

Use `db:push -- --force` only after confirming the target database is empty. It
is not the upgrade command for an existing environment. The current committed
baselines are deliberately rerunnable after a fresh push; `db:migrate` records
them without replacing the schema. Do not hand-edit Drizzle's migration ledger
in production.

For every later schema change, generate and review the SQL artifact before
applying it:

    NODE_ENV=development npm run db:generate
    NODE_ENV=development npm run db:migrate

Never deploy code that expects a migration before the migration succeeds. Apply
the entire current seven-file migration sequence immediately before the
deployment so the old scheduler has no opportunity to requeue rows that the
first migration correctly marks as source-limited. The matching application
expects the collection-outcome columns, canonical channel identity and landscape
demand table to exist on its first request.

`drizzle/0000_collection_outcome.sql` intentionally clears legacy unproved
coverage. It preserves only
settled Bluesky and YouTube windows that had authoritative pagination, marks
other legacy settled vendor rows source-limited, corrects EnsembleData X
Highlights, and settles only Facebook rows whose latest audit proves the
cursorless cap. More visible blanks after migration are the honest result.

`drizzle/0001_pooled_channel_demands.sql` adds collision-checked global channel
identity and exact landscape demand. It aborts rather than guessing when two
legacy rows normalize to the same public account. If the audit reports a
collision, reconcile the listed histories under operator review and rerun the
audit before migrating.

`drizzle/0002_pooled_identity_invariant.sql` idempotently reasserts the database
check that requires every stored identity key to equal its canonical
platform/handle normalization. `0003_mean_zaran.sql` adds observation
provenance. `0004_lucky_dagger.sql`, `0005_dazzling_mordo.sql` and
`0006_silent_kang.sql` add the durable manual-refresh coordinator, bounded
recovery scheduling, frozen final status and exact coalesced request scopes.
`npm run db:migrate` applies all seven files in journal order. Do not deploy
this checkout after applying only a prefix of that sequence.

To inspect the result without persisting the production URL locally, inject it
again for the inspection process:

    read -r -s DATA_DUMPSTER_DATABASE_URL
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" NODE_ENV=development npm run db:studio
    unset DATA_DUMPSTER_DATABASE_URL

After the migration succeeds, deploy the matching application immediately and
run the checks in sections 6 and 7.

---

## 5. Seed the workspace

    read -r DATA_DUMPSTER_ADMIN_EMAIL
    read -r -s DATA_DUMPSTER_ADMIN_PASSWORD
    read -r -s DATA_DUMPSTER_DATABASE_URL
    DATABASE_URL="$DATA_DUMPSTER_DATABASE_URL" \
    SEED_ADMIN_EMAIL="$DATA_DUMPSTER_ADMIN_EMAIL" \
    SEED_ADMIN_PASSWORD="$DATA_DUMPSTER_ADMIN_PASSWORD" \
    NODE_ENV=development npm run seed
    unset DATA_DUMPSTER_ADMIN_EMAIL DATA_DUMPSTER_ADMIN_PASSWORD DATA_DUMPSTER_DATABASE_URL

Enter the admin email, password and pooled database URL in that order. The two
secret reads do not echo, and none of the values are written to shell history or
`.env.local`. Prefer your secret manager's equivalent environment injection in
automation.

This creates the Boston Globe Media workspace shape declared in
`scripts/seed.ts`: its companies, public channels, landscapes, starter newsroom
tags and first owner user.

**It creates zero metrics.** Every number in Data Dumpster comes from ingestion. A
seeded number that looks real is a number somebody eventually puts in a deck.

It is idempotent. Entity writes are upserts and landscape membership is replaced
from the declared seed list, so rerunning converges on the same workspace shape.
It preserves an operator's existing channel pause or resume choice.

Paid Instagram and X seed channels start inactive so seeding cannot authorize
vendor spend. Free Bluesky channels and configured YouTube channels can be
collected immediately. Enabling a paid channel is an explicit operating action.

If either seed variable was ever added to Vercel, remove it and redeploy. They
are read only by the seed script and there is no reason for an initial password
to remain in the environment.

---

## 6. First ingestion

Run it by hand before trusting the cron. Bluesky needs no credentials, so this
works on a clean deployment.

    NODE_ENV=development npm run ingest:once -- --platform=bluesky --dry-run

Dry-run performs only a read-only database target query. It previews the
90-day-by-default window and the matched, eligible and untracked pooled channels;
it does not import the writable queue, register demand, call Bluesky or any
other vendor, or write anything. Review that selection, then do it for real:

    NODE_ENV=development npm run ingest:once -- --platform=bluesky

Real runs register the selected demand and then claim only through the same
global state and six-minute lease as cron. The CLI never calls an adapter
directly. It collapses all landscape memberships before applying
`--max-channels`, so a shared account is one target; a concurrent worker may win
the lease and leave this invocation with no local result rather than causing a
duplicate crawl. A channel with no landscape is reported but cannot be crawled.

Useful flags: `--channel=<uuid>` for exactly one channel,
repeatable or comma-separated `--platform=<p>`, `--company=<slug>`,
`--since=YYYY-MM-DD` and `--until=YYYY-MM-DD` for the demand window (default 90
days ending now), `--limit=N` for the per-channel post cap (default 500),
`--concurrency=N` (default 4), `--max-channels=N`, and `--json` for machine
output. Selection filters are combined.

Help, a normal or partial run, an all-skipped run, and a run where another
worker holds every lease exit 0. Exit 1 means an explicitly requested channel
was not found or every result actually attempted failed. Bad flags, missing
database configuration, or a selection whose matched channels are all
untracked exits 2.

Then open the app, sign in, and confirm Cross-Channel renders numbers.

---

## 7. Verify the scheduled endpoints

`vercel.json` declares the approved public-data schedules. Alert, brief and
report-delivery dispatchers remain inactive operating decisions.
Schedule creation, editing, deletion and run-now are admin-only. A report
run-now request must include a stable `Idempotency-Key` header; retry the same
intended run with the same key.

| Path | Schedule | maxDuration |
|---|---|---|
| `/api/cron/refresh` | `*/10 * * * *` | 60s |
| `/api/cron/ingest?mode=scheduled&limit=250&postLimit=500` | `0 0,12 * * *` | 300s |
| `/api/cron/ingest?mode=recover&limit=250&postLimit=500` | `5,15,25,35,45,55 * * * *` | 300s |

These are the reviewed active schedules documented in `docs/CRONS.md`. The
refresh route wakes one existing coordinator and creates no estate demand. Only
the `scheduled` ingest mode reconciles newly due profiles. The offset `recover`
mode can drain only durable work already created by one of the two daily
windows. `maxDuration` is route segment config inside each route file.

Vercel Cron sends the CRON_SECRET automatically in the Authorization header on
Pro plans. Test one by hand:

    curl -i -H "Authorization: Bearer $CRON_SECRET" 'https://your-app.vercel.app/api/cron/ingest?mode=recover&limit=1&postLimit=25'

Expect 200 and a JSON summary. An x-cron-secret header is also accepted, which is
easier to reach for during an incident.

- 403 with "Scheduled jobs are disabled" means CRON_SECRET is not set in
  production.
- 401 means the value does not match.

Check the health endpoint, which is public by design because an uptime probe has
no credentials:

    curl https://your-app.vercel.app/api/health

It reports whether each required variable is set (as a boolean, never a value),
whether the database answers, per-platform last successful ingest, and how many
demanded channels are overdue past 24 hours. It deliberately separates "the app
is up" from "the data is fresh", because a deployment that responds but has not
ingested in three days is not healthy.

Interpret the response exactly:

- database failure returns HTTP 503 and `status: "down"`;
- missing required configuration, any overdue active demanded channel, or any
  incomplete closed audience day returns HTTP 200 and `status: "degraded"`;
- only a fully passing check returns HTTP 200 and `status: "ok"`.

The coverage series uses Eastern calendar days and treats a closed day as
operationally complete at 98 percent of active demanded audience-bearing
channels. Orphan active channels do not enter the denominator. Today is not used
to degrade status while the recovery sweeps can still act. Reddit user sources
are excluded because they have no follower stock. `lastSuccessfulIngestAt`
reports the latest settled source-attempt boundary, including a useful partial
response. `overdueChannels` uses only certified `coverageUntil`, so a fresh
terminal source limitation remains overdue.

Point an uptime monitor at it.

---

## 8. Add the first real data source

### YouTube, ten minutes, free, and the best first step

1. console.cloud.google.com, create a project.
2. APIs and Services, Library, YouTube Data API v3, Enable.
3. Credentials, Create Credentials, API key. Restrict it to the YouTube Data API.
4. Set `YOUTUBE_API_KEY` in Vercel. Public pooled collection deliberately uses a
   deployment source rather than an organization credential.
5. Run ingestion for one channel and check it:

       NODE_ENV=development npm run ingest:once -- --platform=youtube --max-channels=1

Quota is currently configured by Google and can change. Measure calls and quota
against the deployed landscape rather than relying on a copied estate-size
estimate. See section 7 of `docs/DATA-ACCESS.md` for the request arithmetic.

### Bluesky, zero minutes

Already works. No key, no account, no application. Full post and follower data
for any public account. Pooled collection deliberately ignores
`BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD` so a deployment identity cannot
change the shared observation path.

### Adding a company and channel

Settings, Companies. Add the company, then add a channel per platform handle.
Only platforms with an implemented **public profile onboarding** path appear in
the picker. Facebook is temporarily excluded because its current vendor resolves
identity only inside the paid posts crawl, and verification must not buy that
crawl twice. LinkedIn company pages are available through the Bright Data public
source. Owned-mode requests return an explicit containment error until private
storage and verified bindings ship.

Then add the company to a landscape and set the sort order.

The platform account is a global pooled identity, not a copy owned by that
landscape. Adding the same company or account to another landscape records a
second private demand against the same channel row; fresh stored coverage is
reused, and only an older uncovered window can widen the one global job. After
every fetch, the runner must normalize and claim the returned stable platform id
before writing observations. A blank, changed or already-claimed id stops as a
permanent operator-review failure with no observation writes and no automatic
history merge.

There is no product/API delete for pooled companies or public channels. Remove
the company from a landscape to remove only that landscape's demand while
preserving history for a later re-add. A channel may be globally quarantined or
resumed only by an administrator sending explicit global scope, and not through
one organization while another organization shares its company.

### Adding a model connection

Settings, Models. Pick a provider, enter a model id (free text; the suggestions
are only suggestions), paste a key, optionally set input and output prices per
million tokens so the spend panel shows real dollars. Save, then use the health
check button, which makes a live call and stores the result, so the green tick
means something.

For Ollama, set the provider to Ollama, leave the key blank, and set the base URL
to your endpoint. No egress, no key.

---

## 9. Troubleshooting

**Build fails on a missing module or a type error.** Almost always
NODE_ENV=production having eaten the devDependencies. Delete node_modules and
reinstall with NODE_ENV=development.

**"DATABASE_URL is not set" at runtime.** The module throws at import, so the
whole app fails rather than one route. Check the variable exists in the right
Vercel environment and that the deployment is newer than the variable.

**Too many connections, or intermittent database timeouts under cron load.** You
are on the unpooled connection string. Switch to the one with "-pooler" in the
host.

**"ENCRYPTION_KEY must be set to a random string of at least 32 characters."**
Exactly what it says. Note the length check is on characters, not bytes.

**Stored credentials stopped decrypting.** ENCRYPTION_KEY changed. There is no
re-encryption tool. Re-enter the credentials in Settings. Pooled collection does
not read these organization credentials, so public ingestion continues; model
connections and future owned-native use of the affected secrets do not.

**Cron returns 403.** CRON_SECRET is unset in production. It fails closed on
purpose.

**Cron returns 401.** The value does not match. Watch for a trailing newline from
a copy-paste.

**Ingestion runs but nothing appears.** Check the ingestion_runs table. It records
status, posts upserted, snapshots upserted, API calls and error text per channel.
Most common causes, in order: the channel is inactive (the seed marks
paid Instagram and X sources inactive on purpose), no credentials are configured
for that platform, or the handle does not resolve.

**One competitor is stale and the rest are fine.** Expected behaviour, not a bug.
Failures are isolated per channel so one bad source response cannot take down
the batch. The reason is in that channel's most recent ingestion_runs row.

**Ingest cron times out at 300 seconds.** Inspect per-platform latency and queue
outcomes before changing concurrency. Shard claims by platform or a stable
channel bucket, or move ingestion to a separate worker service. The durable
database queue already preserves unfinished claims. Most writes are upserts;
posted URLs use a scoped delete-then-insert, and cursor-last ordering makes the
next run repair a cut-off channel.

**A competitor platform is blank or source-limited.** Check exact-window
collection coverage before checking post count. Existing Facebook profiles and
LinkedIn company pages use the approved Bright Data deployment source; TikTok
needs an approved purchased source; LinkedIn and cursorless vendor results do
not certify historical exhaustion; and EnsembleData X Highlights never certify
a chronological window. An unmeasured row belongs below measured competitors
with no rank, not at zero.

**Engagement rate by view is blank everywhere.** Also not a bug. No public API
exposes impressions for every competitor. The derived rate is unavailable when
there is no positive measured view denominator. Some adapters normalize an
unexposed raw counter to 0, so do not interpret `posts.views` alone as proof
that nobody saw the content.

**A brief or Ask request returns 422.** The model failed deterministic
fact-sheet verification after one repair. No unverified prose was saved or
shown. Inspect server verification counts, then try a more capable model or
reduce the requested scope. Do not turn the failure into a warning-only path.

**Model calls fail with a 401.** The key is wrong or expired. The client fails
fast rather than retrying, because retrying a 401 three times wastes time and
hides the fix. Re-enter it in Settings and use the health check button.

**X spend is higher than expected.** The refresh overlap window is the dial. It
is two days and it multiplies read volume. Check ingestion audit calls and
outcomes before changing it. A terminal source limitation should refresh from
its attempt watermark; if it repeatedly buys the full 90-day window, treat that
as a queue regression.

**The server's local time zone differs from Eastern.** That is supported.
Analytics and brief periods are explicitly pinned to `America/New_York`, and
report schedules carry their own IANA time zone. Do not add a required `TZ`
environment variable as a workaround.

---

## 10. Post-deploy checklist

- [ ] Pooled channel identity audit passed before migration
- [ ] Every committed migration from `0000` through `0006` succeeded before matching code was deployed
- [ ] /api/health returns database true and all four config booleans true
- [ ] /api/health status and coverage caveats reviewed; `degraded` is not
      treated as an uptime success
- [ ] An uptime monitor is pointed at /api/health
- [ ] Signed in with the seeded admin, then changed the password
- [ ] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD removed from Vercel
- [ ] Every cron route declared in `vercel.json` manually tested before activation
- [ ] At least one ingestion run succeeded for Bluesky and one for YouTube
- [ ] Cross-Channel renders real numbers for a real landscape
- [ ] A model connection saved with a passing health check
- [ ] One brief generated and its verification verdict read
- [ ] Owned-native collection disabled unless the isolation release gate and
      cross-tenant tests are complete
- [ ] Legacy pooled rows inventoried, quarantined where ambiguous, and
      re-collected from approved public sources before multi-organization use
- [ ] Every purchased platform source has a recorded Legal/procurement decision
- [ ] A channel shared by two landscapes resolves to one channel row, one
      collection-state row and two private demand rows without a duplicate crawl
- [ ] The landscape membership reviewed by a person, on the record, because it
      changes share of voice and share of engagement for everybody in it
