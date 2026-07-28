# Deploying Pressbox to production

Assumes you are comfortable with Vercel, Postgres and a terminal, and have never
seen this repository. Start to finish is about 45 minutes if you stick to the
sources that need no approval (Bluesky, YouTube, RSS).

Read "docs/DATA-ACCESS.md" before promising anyone a Facebook, TikTok or LinkedIn
competitor chart. Those do not exist.

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

**Use the pooled connection string.** Pressbox uses the Neon serverless HTTP
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

### Seeding, temporary

| Variable | Value |
|---|---|
| SEED_ADMIN_EMAIL | The first login |
| SEED_ADMIN_PASSWORD | A real password. Remove both after step 5 |

### Data sources, all optional

Per-org credentials entered in Settings, Sources always take precedence over
these. The environment values are a fallback for a single-org deployment.

| Variable | Notes |
|---|---|
| YOUTUBE_API_KEY | Free. console.cloud.google.com, create a project, enable YouTube Data API v3, create an API key. Ten minutes. 10,000 units a day |
| TWITTER_BEARER_TOKEN | Paid. Metered since February 2026. See docs/DATA-ACCESS.md before enabling |
| BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD | Optional. Public reads need no key at all; an app password lifts rate limits |
| META_ACCESS_TOKEN, META_APP_ID, META_APP_SECRET | Owned Pages and Instagram Business. Requires Meta App Review, weeks |
| META_IG_USER_ID | The Instagram Business account id your token belongs to. Required for competitor Business Discovery lookups, not just your own account |
| TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN | Owned accounts only. Access tokens expire in 24 hours; the refresh token must be stored |
| LINKEDIN_ACCESS_TOKEN | Owned pages only. 60-day member OAuth. Marketing Developer Platform approval takes weeks and can be refused |

### Model, optional

Configure connections in Settings, Models instead. These are a fallback default.

| Variable | Notes |
|---|---|
| DEFAULT_MODEL_PROVIDER | One of anthropic, openai, google, azure_openai, openai_compatible, ollama. An unrecognised value throws with the valid list |
| DEFAULT_MODEL | Free text model id |
| ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY | Whichever matches |

### Delivery, optional

| Variable | Notes |
|---|---|
| SLACK_WEBHOOK_URL | Default alert destination. Per-rule destinations override it |

---

## 4. Deploy and create the schema

Import the repository in Vercel and deploy. The build runs "next build" and
should pass; the repository typechecks clean under TypeScript strict.

The schema is not created by the build. Push it from your machine, once, against
the production DATABASE_URL.

    cd /path/to/pressbox
    NODE_ENV=development npm install
    echo 'DATABASE_URL="<the pooled production URL>"' > .env.local
    NODE_ENV=development npm run db:push

"db:push" is drizzle-kit's diff-and-apply. It prints what it will change and asks
before destructive operations. For the initial creation there is nothing to
destroy. For later schema changes on a database with real data, generate and
review a migration instead:

    NODE_ENV=development npm run db:generate

Confirm the schema landed:

    NODE_ENV=development npm run db:studio

---

## 5. Seed the workspace

    SEED_ADMIN_EMAIL=you@bostonglobe.com \
    SEED_ADMIN_PASSWORD='a real password' \
    NODE_ENV=development npm run seed

This creates the Boston Globe Media org, eight companies (the Globe, Boston.com,
STAT, Boston Herald, WBUR, GBH News, Axios Boston, Globe Sports) with their real
public channels, two landscapes, eight newsroom tags, and one owner user.

**It creates zero metrics.** Every number in Pressbox comes from ingestion. A
seeded number that looks real is a number somebody eventually puts in a deck.

It is idempotent. Every write is an upsert against a unique index, so running it
twice changes nothing and running it against a live database is safe.

Channels on platforms with no competitor read path are seeded inactive, so the
ingest runner skips them rather than failing on them every three hours.

**Now remove SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from Vercel** and redeploy.
They are only read by the seed script and there is no reason for a password to
sit in the environment.

---

## 6. First ingestion

Run it by hand before trusting the cron. Bluesky and RSS need no credentials, so
this works on a clean deployment.

    NODE_ENV=development npm run ingest:once -- --platform=bluesky,rss --dry-run

Dry run fetches and reports and writes nothing. If the numbers look sane, do it
for real:

    NODE_ENV=development npm run ingest:once -- --platform=bluesky,rss

Useful flags: --channel=<uuid> for exactly one channel, --company=<slug>,
--since=YYYY-MM-DD to override the window, --limit=N (default 500),
--concurrency=N (default 4), --max-channels=N, --json for machine output.

The exit code is 1 only when every attempted channel failed, so a CI wrapper can
distinguish "nothing worked" from "one token expired". A run where everything was
skipped for missing credentials exits 0 with a warning, because that is a
configuration state and not a failure.

Then open the app, sign in, and confirm Cross-Channel renders numbers.

---

## 7. Verify the cron jobs

Three are declared in "vercel.json" and appear under Project, Settings, Cron Jobs
after the first production deploy.

| Path | Schedule | maxDuration |
|---|---|---|
| /api/cron/ingest | 0 */3 * * * | 300s |
| /api/cron/alerts | 20 * * * * | 120s |
| /api/cron/brief | 0 6 * * 1 | 300s |

Reasoning for each schedule is in "docs/CRONS.md". maxDuration is route segment
config inside each route file rather than in "vercel.json", which is authoritative
on Vercel and cannot silently stop matching if a file moves.

Vercel Cron sends the CRON_SECRET automatically in the Authorization header on
Pro plans. Test one by hand:

    curl -i -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/ingest

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
channels are overdue past 24 hours. It deliberately separates "the app is up"
from "the data is fresh", because a deployment that responds but has not ingested
in three days is not healthy.

Point an uptime monitor at it.

---

## 8. Add the first real data source

### YouTube, ten minutes, free, and the best first step

1. console.cloud.google.com, create a project.
2. APIs and Services, Library, YouTube Data API v3, Enable.
3. Credentials, Create Credentials, API key. Restrict it to the YouTube Data API.
4. Either set YOUTUBE_API_KEY in Vercel, or better, paste it into Settings,
   Sources in the app, where it is encrypted at rest with your ENCRYPTION_KEY and
   scoped to the org.
5. Run ingestion for one channel and check it:

       NODE_ENV=development npm run ingest:once -- --platform=youtube --max-channels=1

Quota is 10,000 units a day. A channel refresh costs about three units per fifty
videos, so a landscape of twenty competitors on a three-hour cadence uses a small
fraction of it. See section 7 of "docs/DATA-ACCESS.md" for the arithmetic.

### Bluesky, zero minutes

Already works. No key, no account, no application. Full post and follower data
for any public account. Setting BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD only
lifts rate limits.

### Adding a company and channel

Settings, Companies. Add the company, then add a channel per platform handle.
Only platforms with an implemented adapter appear in the picker, because
"hasAdapter()" gates it. Each adapter's accessNotes render in the UI, so if a
platform cannot answer a question you find out while configuring it rather than
from a confusing chart three weeks later.

Then add the company to a landscape and set the sort order.

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
re-encryption tool. Re-enter the credentials in Settings. The runner skips and
warns about a credential it cannot decrypt rather than failing the whole batch,
so the symptom is one platform going quiet, not an outage.

**Cron returns 403.** CRON_SECRET is unset in production. It fails closed on
purpose.

**Cron returns 401.** The value does not match. Watch for a trailing newline from
a copy-paste.

**Ingestion runs but nothing appears.** Check the ingestion_runs table. It records
status, posts upserted, snapshots upserted, API calls and error text per channel.
Most common causes, in order: the channel is inactive (the seed marks
unreadable platforms inactive on purpose), no credentials are configured for that
platform, or the handle does not resolve.

**One competitor is stale and the rest are fine.** Expected behaviour, not a bug.
Failures are isolated per channel so one expired token cannot take down the
batch. The reason is in that channel's most recent ingestion_runs row.

**Ingest cron times out at 300 seconds.** You have crossed roughly 200 to 250
channels. Raise --concurrency, shard the cron by platform, or move ingestion to a
queue. Partial completion is safe: every write is an upsert, and the runner
selects stalest-first, so the channels that were cut off are the first ones
processed next run.

**Charts show zero for Facebook, TikTok or LinkedIn competitors.** Not a bug.
That data does not exist for a commercial organisation in 2026. Read
"docs/DATA-ACCESS.md". The registry exports OWNED_ONLY_PLATFORMS and isOwnedOnly
so the UI can keep those platforms out of competitor comparisons.

**Engagement rate by view is blank everywhere.** Also not a bug. No public API
exposes impressions for content you do not own. Views of 0 means "not exposed",
and the metrics layer stores NULL rather than 0 so the difference survives.

**A brief generates but the verification panel is red.** The model made a claim
that does not trace to the fact sheet. The panel names every ungrounded number
and the nearest fact-sheet value with its path. If it happens often, the model is
too small for the task; try a larger one and compare. The design intent is that
this failure is visible rather than silent.

**Model calls fail with a 401.** The key is wrong or expired. The client fails
fast rather than retrying, because retrying a 401 three times wastes time and
hides the fix. Re-enter it in Settings and use the health check button.

**X spend is higher than expected.** The refresh overlap window is the dial. It
is a two-day constant in "src/lib/adapters/runner.ts" and it multiplies your read
count directly. Check ingestion_runs.apiCalls for the real number before
changing anything.

---

## 10. Post-deploy checklist

- [ ] /api/health returns database true and all four config booleans true
- [ ] An uptime monitor is pointed at /api/health
- [ ] Signed in with the seeded admin, then changed the password
- [ ] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD removed from Vercel
- [ ] All three cron jobs listed in the Vercel dashboard and manually triggered once
- [ ] At least one ingestion run succeeded for Bluesky and one for YouTube
- [ ] Cross-Channel renders real numbers for a real landscape
- [ ] A model connection saved with a passing health check
- [ ] One brief generated and its verification verdict read
- [ ] The landscape membership reviewed by a person, on the record, because it
      changes share of voice and share of engagement for everybody in it
