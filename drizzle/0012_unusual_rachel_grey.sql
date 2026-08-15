ALTER TYPE "public"."platform" ADD VALUE 'truth_social' BEFORE 'rss';--> statement-breakpoint
CREATE TABLE "election_profile_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "election_profile_sources_status_ck" CHECK ("election_profile_sources"."status" IN ('pending', 'connected', 'paused', 'skipped', 'error'))
);
--> statement-breakpoint
ALTER TABLE "election_profile_sources" ADD CONSTRAINT "election_profile_sources_candidate_id_election_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."election_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_profile_sources" ADD CONSTRAINT "election_profile_sources_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "election_profile_sources_candidate_platform_uq" ON "election_profile_sources" USING btree ("candidate_id","platform");--> statement-breakpoint
CREATE INDEX "election_profile_sources_status_idx" ON "election_profile_sources" USING btree ("status","platform");
--> statement-breakpoint

-- Seed the campaign-only roster supplied for the Massachusetts Democratic
-- Senate primary. Companies are pooled, so the same candidate and historical
-- channel data can be reused by every race and landscape without another crawl.
INSERT INTO "companies" ("org_id", "name", "slug", "website", "segment", "color")
SELECT o."id", 'Ed Markey', 'ed-markey', 'https://www.edmarkey.com', 'political candidate', '#0B5998'
FROM "orgs" o
ORDER BY o."created_at"
LIMIT 1
ON CONFLICT ("slug") DO UPDATE SET
	"website" = EXCLUDED."website",
	"color" = EXCLUDED."color";
--> statement-breakpoint

INSERT INTO "companies" ("org_id", "name", "slug", "website", "segment", "color")
SELECT o."id", 'Seth Moulton', 'seth-moulton', 'https://sethmoulton.com', 'political candidate', '#7C3AED'
FROM "orgs" o
ORDER BY o."created_at"
LIMIT 1
ON CONFLICT ("slug") DO UPDATE SET
	"website" = EXCLUDED."website",
	"color" = EXCLUDED."color";
--> statement-breakpoint

INSERT INTO "landscape_companies" ("landscape_id", "company_id", "sort_order")
SELECT er."landscape_id", c."id", candidate."sort_order"
FROM "election_races" er
CROSS JOIN (
	VALUES ('ed-markey', 0), ('seth-moulton', 1)
) AS candidate("slug", "sort_order")
JOIN "companies" c ON c."slug" = candidate."slug"
WHERE er."slug" = 'ma-us-senate-democratic-primary-2026'
ON CONFLICT ("landscape_id", "company_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "election_candidates" (
	"race_id", "company_id", "party", "candidate_status", "incumbent"
)
SELECT
	er."id",
	c."id",
	'Democratic',
	'declared',
	(candidate."slug" = 'ed-markey')
FROM "election_races" er
CROSS JOIN (
	VALUES ('ed-markey'), ('seth-moulton')
) AS candidate("slug")
JOIN "companies" c ON c."slug" = candidate."slug"
WHERE er."slug" = 'ma-us-senate-democratic-primary-2026'
ON CONFLICT ("race_id", "company_id") DO UPDATE SET
	"party" = EXCLUDED."party",
	"candidate_status" = EXCLUDED."candidate_status",
	"incumbent" = EXCLUDED."incumbent",
	"updated_at" = now();
--> statement-breakpoint

UPDATE "landscapes" l
SET "focus_company_id" = c."id"
FROM "election_races" er, "companies" c
WHERE er."landscape_id" = l."id"
	AND er."slug" = 'ma-us-senate-democratic-primary-2026'
	AND c."slug" = 'ed-markey'
	AND l."focus_company_id" IS NULL;
--> statement-breakpoint

WITH supplied("candidate_slug", "platform", "url", "status", "note") AS (
	VALUES
		('ed-markey', 'facebook'::platform, 'https://www.facebook.com/EdMarkeyforMA', 'paused', 'Campaign account. New Facebook profile onboarding is paused; keep this URL queued for the existing Bright Data route.'),
		('ed-markey', 'instagram'::platform, 'https://www.instagram.com/edmarkey', 'pending', NULL),
		('ed-markey', 'threads'::platform, 'https://www.threads.com/@edmarkey', 'pending', NULL),
		('ed-markey', 'twitter'::platform, 'https://x.com/EdMarkey', 'pending', NULL),
		('ed-markey', 'youtube'::platform, 'https://www.youtube.com/@markeypress', 'pending', NULL),
		('ed-markey', 'tiktok'::platform, 'https://www.tiktok.com/@ed_markey', 'pending', NULL),
		('ed-markey', 'bluesky'::platform, 'https://bsky.app/profile/edmarkey.bsky.social', 'pending', NULL),
		('seth-moulton', 'facebook'::platform, 'https://www.facebook.com/sethmoulton', 'paused', 'Campaign account. New Facebook profile onboarding is paused; keep this URL queued for the existing Bright Data route.'),
		('seth-moulton', 'instagram'::platform, 'https://www.instagram.com/sethmoulton', 'pending', NULL),
		('seth-moulton', 'threads'::platform, 'https://www.threads.com/@sethmoulton', 'pending', NULL),
		('seth-moulton', 'twitter'::platform, 'https://x.com/sethmoulton', 'pending', NULL),
		('seth-moulton', 'youtube'::platform, 'https://www.youtube.com/@sethmoulton', 'pending', 'The supplied channel mixes congressional-office and campaign material; label that caveat in analysis.'),
		('seth-moulton', 'tiktok'::platform, 'https://www.tiktok.com/@sethmoulton', 'pending', NULL),
		('seth-moulton', 'bluesky'::platform, 'https://bsky.app/profile/sethmoulton.bsky.social', 'pending', 'Not linked from the campaign site. Verify activity on first collection and skip it if the account is dormant or unrelated.')
)
INSERT INTO "election_profile_sources" (
	"candidate_id", "platform", "url", "status", "note"
)
SELECT ec."id", supplied."platform", supplied."url", supplied."status", supplied."note"
FROM supplied
JOIN "companies" c ON c."slug" = supplied."candidate_slug"
JOIN "election_candidates" ec ON ec."company_id" = c."id"
JOIN "election_races" er ON er."id" = ec."race_id"
WHERE er."slug" = 'ma-us-senate-democratic-primary-2026'
ON CONFLICT ("candidate_id", "platform") DO UPDATE SET
	"url" = EXCLUDED."url",
	"status" = EXCLUDED."status",
	"note" = EXCLUDED."note",
	"updated_at" = now();
