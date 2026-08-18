CREATE TABLE "wikipedia_attention" (
	"page_title" text NOT NULL,
	"day" date NOT NULL,
	"views" bigint NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wikipedia_attention_pk" PRIMARY KEY("page_title","day")
);
--> statement-breakpoint
ALTER TABLE "election_candidates" ADD COLUMN "wikipedia_title" text;--> statement-breakpoint
CREATE INDEX "wikipedia_attention_day_idx" ON "wikipedia_attention" USING btree ("day");