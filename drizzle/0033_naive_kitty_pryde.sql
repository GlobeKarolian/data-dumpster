CREATE TABLE "vendor_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"vendor" text NOT NULL,
	"resource" text NOT NULL,
	"subject" text,
	"records" integer DEFAULT 0 NOT NULL,
	"stored" integer DEFAULT 0 NOT NULL,
	"snapshot_id" text,
	"estimated_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_spend" ADD CONSTRAINT "vendor_spend_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_spend_window_idx" ON "vendor_spend" USING btree ("vendor","created_at");