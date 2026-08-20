CREATE TABLE "group_collection_state" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"outcome" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"resume_snapshot_id" text,
	"last_error" text,
	"last_collected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"posted_at" timestamp with time zone,
	"content" text,
	"author_name" text,
	"author_profile_url" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"permalink" text,
	"urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_collection_state" ADD CONSTRAINT "group_collection_state_group_id_watched_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."watched_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_group_id_watched_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."watched_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_groups" ADD CONSTRAINT "watched_groups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_collection_state_next_idx" ON "group_collection_state" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_posts_dedupe_idx" ON "group_posts" USING btree ("org_id","group_id","external_id");--> statement-breakpoint
CREATE INDEX "group_posts_group_time_idx" ON "group_posts" USING btree ("group_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_groups_org_url_idx" ON "watched_groups" USING btree ("org_id","url");--> statement-breakpoint
CREATE INDEX "watched_groups_org_active_idx" ON "watched_groups" USING btree ("org_id","active");