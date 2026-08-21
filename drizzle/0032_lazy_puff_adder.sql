CREATE TABLE "group_post_tag_assignments" (
	"group_post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" "tag_source" DEFAULT 'ai' NOT NULL,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_post_tag_assignments_group_post_id_tag_id_pk" PRIMARY KEY("group_post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "group_tag_state" (
	"org_id" uuid NOT NULL,
	"group_post_id" uuid NOT NULL,
	"taxonomy_fingerprint" text NOT NULL,
	"model" text,
	"status" "ingest_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"tagged_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_tag_state_pk" PRIMARY KEY("org_id","group_post_id")
);
--> statement-breakpoint
ALTER TABLE "group_post_tag_assignments" ADD CONSTRAINT "group_post_tag_assignments_group_post_id_group_posts_id_fk" FOREIGN KEY ("group_post_id") REFERENCES "public"."group_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_post_tag_assignments" ADD CONSTRAINT "group_post_tag_assignments_tag_id_post_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."post_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag_state" ADD CONSTRAINT "group_tag_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag_state" ADD CONSTRAINT "group_tag_state_group_post_id_group_posts_id_fk" FOREIGN KEY ("group_post_id") REFERENCES "public"."group_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gpta_tag_idx" ON "group_post_tag_assignments" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "group_tag_state_next_attempt_idx" ON "group_tag_state" USING btree ("next_attempt_at");