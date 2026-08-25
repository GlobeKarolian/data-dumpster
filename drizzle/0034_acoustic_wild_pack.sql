CREATE TABLE "comment_collection_state" (
	"post_id" uuid PRIMARY KEY NOT NULL,
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
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"author_name" text,
	"author_url" text,
	"text" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"commented_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_collection_state" ADD CONSTRAINT "comment_collection_state_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_collection_state_next_idx" ON "comment_collection_state" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_comments_dedupe_idx" ON "post_comments" USING btree ("post_id","external_id");--> statement-breakpoint
CREATE INDEX "post_comments_post_time_idx" ON "post_comments" USING btree ("post_id","commented_at");