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
	AND state."last_error" = 'No approved public-comparable source is configured for Truth Social.';
