CREATE TABLE "election_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"party" text,
	"candidate_status" text DEFAULT 'tracking' NOT NULL,
	"incumbent" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "election_candidates_status_ck" CHECK ("election_candidates"."candidate_status" IN ('tracking', 'declared', 'filed', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "election_races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"landscape_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"office" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"election_date" date,
	"status" text DEFAULT 'setup' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "election_races_status_ck" CHECK ("election_races"."status" IN ('setup', 'active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "election_candidates" ADD CONSTRAINT "election_candidates_race_id_election_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."election_races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_candidates" ADD CONSTRAINT "election_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_races" ADD CONSTRAINT "election_races_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_races" ADD CONSTRAINT "election_races_landscape_id_landscapes_id_fk" FOREIGN KEY ("landscape_id") REFERENCES "public"."landscapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "election_candidates_race_company_uq" ON "election_candidates" USING btree ("race_id","company_id");--> statement-breakpoint
CREATE INDEX "election_candidates_race_status_idx" ON "election_candidates" USING btree ("race_id","candidate_status");--> statement-breakpoint
CREATE UNIQUE INDEX "election_races_org_slug_uq" ON "election_races" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "election_races_landscape_uq" ON "election_races" USING btree ("landscape_id");--> statement-breakpoint
CREATE INDEX "election_races_org_status_idx" ON "election_races" USING btree ("org_id","status","election_date");--> statement-breakpoint

-- Start Election Center with the race requested for the current newsroom. The
-- backing landscape is deliberately not a normal analytical landscape: the app
-- hides it from the switcher and Election Center owns its presentation. It
-- exists so candidate profiles reuse the pooled collection queue and history.
INSERT INTO "landscapes" ("org_id", "name", "slug", "description")
SELECT
	o."id",
	'Massachusetts U.S. Senate Democratic Primary · 2026',
	'election-ma-us-senate-democratic-primary-2026',
	'Internal collection scope for the 2026 Massachusetts U.S. Senate Democratic primary.'
FROM "orgs" o
WHERE NOT EXISTS (
	SELECT 1
	FROM "landscapes" l
	WHERE l."org_id" = o."id"
		AND l."slug" = 'election-ma-us-senate-democratic-primary-2026'
);--> statement-breakpoint

INSERT INTO "election_races" (
	"org_id",
	"landscape_id",
	"name",
	"slug",
	"office",
	"jurisdiction",
	"election_date",
	"status",
	"description"
)
SELECT
	l."org_id",
	l."id",
	'Massachusetts U.S. Senate Democratic Primary',
	'ma-us-senate-democratic-primary-2026',
	'U.S. Senate',
	'Massachusetts',
	'2026-09-01'::date,
	'setup',
	'Track the campaign social presence and content performance of the 2026 Massachusetts Democratic U.S. Senate primary field.'
FROM "landscapes" l
WHERE l."slug" = 'election-ma-us-senate-democratic-primary-2026'
	AND NOT EXISTS (
		SELECT 1
		FROM "election_races" er
		WHERE er."org_id" = l."org_id"
			AND er."slug" = 'ma-us-senate-democratic-primary-2026'
	);--> statement-breakpoint

-- Existing restricted users receive the same explicit grant model used by
-- ordinary landscapes. New races grant their creator in the API.
INSERT INTO "user_landscape_access" ("user_id", "landscape_id", "granted_by")
SELECT u."id", er."landscape_id", u."id"
FROM "election_races" er
JOIN "users" u ON u."org_id" = er."org_id"
WHERE er."slug" = 'ma-us-senate-democratic-primary-2026'
ON CONFLICT ("user_id", "landscape_id") DO NOTHING;
