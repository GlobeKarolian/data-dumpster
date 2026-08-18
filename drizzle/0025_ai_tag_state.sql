CREATE TABLE "ai_tag_state" (
	"org_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"taxonomy_fingerprint" text NOT NULL,
	"model" text,
	"status" "ingest_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"tagged_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tag_state_pk" PRIMARY KEY("org_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "ai_tag_state" ADD CONSTRAINT "ai_tag_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tag_state" ADD CONSTRAINT "ai_tag_state_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tag_state_org_fingerprint_idx" ON "ai_tag_state" USING btree ("org_id","taxonomy_fingerprint");--> statement-breakpoint
CREATE INDEX "ai_tag_state_next_attempt_idx" ON "ai_tag_state" USING btree ("next_attempt_at");