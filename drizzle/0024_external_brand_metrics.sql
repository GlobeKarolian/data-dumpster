-- Vendor-supplied brand-week metrics that predate our own collection.
-- Kept separate from posts and audience_snapshots so a third party's weekly
-- arithmetic can never be mixed into a number this product computed itself.
--
-- Written idempotently on purpose. These objects were applied to production by
-- hand on 17 Aug 2026 (drizzle-kit's generator mangled the statement while
-- still reporting success), so the ledger is behind the physical schema and
-- the next `drizzle-kit migrate` will replay this file. IF NOT EXISTS makes
-- that replay a no-op instead of a failed deploy, and leaves the file correct
-- for a fresh database.
--
-- The enum value this release also needs lives in 0023 and is idempotent
-- there; it is deliberately not repeated here.
--
-- The foreign key is inline rather than a later ALTER: the Neon HTTP driver
-- runs one statement per request and cannot execute a dollar-quoted DO block,
-- which is the usual way to make a bare ADD CONSTRAINT re-runnable.
CREATE TABLE IF NOT EXISTS "external_brand_metrics" (
	"company_id" uuid NOT NULL REFERENCES "public"."companies"("id") ON DELETE cascade,
	"platform" "platform" NOT NULL,
	"metric" text NOT NULL,
	"period_start" date NOT NULL,
	"period_days" integer DEFAULT 7 NOT NULL,
	"value" bigint NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_brand_metrics_pk" PRIMARY KEY("company_id","platform","metric","period_start","source"),
	CONSTRAINT "external_brand_metrics_period_days_ck" CHECK ("external_brand_metrics"."period_days" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_brand_metrics_period_idx" ON "external_brand_metrics" USING btree ("period_start");
