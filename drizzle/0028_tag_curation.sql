CREATE TABLE "tag_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label_norm" text NOT NULL,
	"verdict" text NOT NULL,
	"name" text,
	"definition" text,
	"parent_tag_id" uuid,
	"covered_by_tag_id" uuid,
	"confidence" double precision,
	"rationale" text,
	"support_posts" integer DEFAULT 0 NOT NULL,
	"support_companies" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb,
	"created_tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tag_suggestions" (
	"org_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_norm" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tag_suggestions_pk" PRIMARY KEY("org_id","post_id","label_norm")
);
--> statement-breakpoint
ALTER TABLE "tag_proposals" ADD CONSTRAINT "tag_proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_proposals" ADD CONSTRAINT "tag_proposals_parent_tag_id_post_tags_id_fk" FOREIGN KEY ("parent_tag_id") REFERENCES "public"."post_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_proposals" ADD CONSTRAINT "tag_proposals_covered_by_tag_id_post_tags_id_fk" FOREIGN KEY ("covered_by_tag_id") REFERENCES "public"."post_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_proposals" ADD CONSTRAINT "tag_proposals_created_tag_id_post_tags_id_fk" FOREIGN KEY ("created_tag_id") REFERENCES "public"."post_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_resolved_tag_id_post_tags_id_fk" FOREIGN KEY ("resolved_tag_id") REFERENCES "public"."post_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tag_proposals_org_time_idx" ON "tag_proposals" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "tag_proposals_org_label_idx" ON "tag_proposals" USING btree ("org_id","label_norm");--> statement-breakpoint
CREATE INDEX "tag_suggestions_open_idx" ON "tag_suggestions" USING btree ("org_id","status","label_norm");