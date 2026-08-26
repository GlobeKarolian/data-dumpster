CREATE TABLE "daily_comment_digests" (
	"day" date PRIMARY KEY NOT NULL,
	"digest" text NOT NULL,
	"summaries_considered" integer DEFAULT 0 NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
