-- Vendor-supplied brand-week metrics that predate our own collection.
-- Kept separate from posts and audience_snapshots so a third party's weekly
-- arithmetic can never be mixed into a number this product computed itself.
--
-- The foreign key is inline rather than a later ALTER wrapped in DO $$: the
-- Neon HTTP driver runs one statement per request and cannot execute a
-- dollar-quoted block, and CREATE TABLE IF NOT EXISTS already makes this
-- re-runnable without one.
CREATE TABLE IF NOT EXISTS "external_brand_metrics" (
  "company_id" uuid NOT NULL REFERENCES "public"."companies"("id") ON DELETE cascade,
  "platform" "platform" NOT NULL,
  "metric" text NOT NULL,
  "period_start" date NOT NULL,
  "period_days" integer DEFAULT 7 NOT NULL,
  "value" bigint NOT NULL,
  "source" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "external_brand_metrics_pk"
    PRIMARY KEY ("company_id", "platform", "metric", "period_start", "source"),
  CONSTRAINT "external_brand_metrics_period_days_ck" CHECK ("period_days" > 0)
);

CREATE INDEX IF NOT EXISTS "external_brand_metrics_period_idx"
  ON "external_brand_metrics" USING btree ("period_start");
