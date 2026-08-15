UPDATE "channel_collection_state" AS state
SET
	"status" = 'queued',
	"next_attempt_at" = now(),
	"last_error" = NULL,
	"outcome" = NULL,
	"updated_at" = now()
FROM "channels" AS channel
WHERE state."channel_id" = channel."id"
	AND channel."platform" = 'truth_social'
	AND state."status" = 'failed'
	AND state."next_attempt_at" IS NULL
	AND state."last_error" IN (
		'No usable credentials for Truth Social. Missing: all fields.',
		'No approved public-comparable source is configured for Truth Social.'
	);--> statement-breakpoint

UPDATE "election_profile_sources" AS source
SET
	"status" = 'pending',
	"updated_at" = now()
FROM "election_candidates" AS candidate
JOIN "election_races" AS race ON race."id" = candidate."race_id"
JOIN "companies" AS company ON company."id" = candidate."company_id"
WHERE source."candidate_id" = candidate."id"
	AND race."slug" = '2028-presidential-watchlist'
	AND company."slug" = 'vivek-ramaswamy'
	AND source."platform" = 'truth_social'
	AND source."status" = 'review';
