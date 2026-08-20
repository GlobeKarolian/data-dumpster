CREATE TABLE "story_narratives" (
	"org_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"bucket_date" date NOT NULL,
	"granularity" text DEFAULT 'day' NOT NULL,
	"narrative" text NOT NULL,
	"posts_considered" integer DEFAULT 0 NOT NULL,
	"engagement_at_write" double precision DEFAULT 0 NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_narratives_pk" PRIMARY KEY("org_id","tag_id","bucket_date","granularity")
);
--> statement-breakpoint
ALTER TABLE "story_narratives" ADD CONSTRAINT "story_narratives_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_narratives" ADD CONSTRAINT "story_narratives_tag_id_post_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."post_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_narratives_lookup_idx" ON "story_narratives" USING btree ("org_id","granularity","bucket_date");