CREATE TABLE "post_tag_landscapes" (
	"tag_id" uuid NOT NULL,
	"landscape_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_tag_landscapes_pk" PRIMARY KEY("tag_id","landscape_id")
);
--> statement-breakpoint
ALTER TABLE "post_tag_landscapes" ADD CONSTRAINT "post_tag_landscapes_tag_id_post_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."post_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag_landscapes" ADD CONSTRAINT "post_tag_landscapes_landscape_id_landscapes_id_fk" FOREIGN KEY ("landscape_id") REFERENCES "public"."landscapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_tag_landscapes_landscape_idx" ON "post_tag_landscapes" USING btree ("landscape_id");