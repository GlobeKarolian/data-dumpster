CREATE TABLE "comment_summaries" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"summary" text,
	"comments_considered" integer DEFAULT 0 NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_summaries" ADD CONSTRAINT "comment_summaries_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;