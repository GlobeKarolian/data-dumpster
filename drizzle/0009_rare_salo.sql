ALTER TABLE "weekly_reports" ADD COLUMN "share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reports_share_uq" ON "weekly_reports" USING btree ("share_token");