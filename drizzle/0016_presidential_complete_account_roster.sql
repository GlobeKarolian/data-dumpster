DROP INDEX "election_profile_sources_candidate_platform_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "election_profile_sources_candidate_platform_url_uq" ON "election_profile_sources" USING btree ("candidate_id","platform","url");--> statement-breakpoint

-- The original watchlist intentionally selected one account per platform. A
-- candidate can have both a personal account and an official office account,
-- and both are part of the public presence editors need to measure. Mirrors,
-- squatters and independently controlled affiliated organizations remain out.
WITH roster("candidate_key", "slug") AS (
	VALUES
		('newsom', 'gavin-newsom'), ('ocasio', 'alexandria-ocasio-cortez'),
		('shapiro', 'josh-shapiro'), ('beshear', 'andy-beshear'),
		('pritzker', 'jb-pritzker'), ('kelly', 'mark-kelly'),
		('booker', 'cory-booker'), ('khanna', 'ro-khanna'),
		('vance', 'jd-vance'), ('rubio', 'marco-rubio'),
		('desantis', 'ron-desantis'), ('cruz', 'ted-cruz'),
		('randpaul', 'rand-paul'), ('ramaswamy', 'vivek-ramaswamy'),
		('kemp', 'brian-kemp')
), supplied("candidate_key", "platform", "url", "note") AS (
	VALUES
		('newsom', 'bluesky'::platform, 'https://bsky.app/profile/governor.ca.gov', 'Official government account. Active account identified in the August 14 audit.'),
		('newsom', 'instagram'::platform, 'https://www.instagram.com/cagovernor/', 'Official government account.'),
		('newsom', 'tiktok'::platform, 'https://www.tiktok.com/@cagovernor', 'Official government account.'),
		('newsom', 'twitter'::platform, 'https://x.com/CAgovernor', 'Official government account.'),
		('ocasio', 'bluesky'::platform, 'https://bsky.app/profile/ocasio-cortez.house.gov', 'Official congressional account.'),
		('ocasio', 'twitter'::platform, 'https://x.com/RepAOC', 'Official congressional account.'),
		('shapiro', 'bluesky'::platform, 'https://bsky.app/profile/governor.pa.gov', 'Official government account.'),
		('shapiro', 'twitter'::platform, 'https://x.com/GovernorShapiro', 'Official government account.'),
		('beshear', 'bluesky'::platform, 'https://bsky.app/profile/govandybeshear.bsky.social', 'Official government account.'),
		('beshear', 'twitter'::platform, 'https://x.com/govandybeshear', 'Official government account.'),
		('pritzker', 'bluesky'::platform, 'https://bsky.app/profile/govpritzker.illinois.gov', 'Official government account.'),
		('pritzker', 'twitter'::platform, 'https://x.com/govpritzker', 'Official government account.'),
		('kelly', 'twitter'::platform, 'https://x.com/SenMarkKelly', 'Official congressional account.'),
		('booker', 'bluesky'::platform, 'https://bsky.app/profile/booker.senate.gov', 'Official congressional account.'),
		('booker', 'twitter'::platform, 'https://x.com/SenBooker', 'Official congressional account.'),
		('khanna', 'bluesky'::platform, 'https://bsky.app/profile/khanna.house.gov', 'Official congressional account.'),
		('khanna', 'twitter'::platform, 'https://x.com/RepRoKhanna', 'Official congressional account.'),
		('vance', 'twitter'::platform, 'https://x.com/VP', 'Official vice-presidential account. Staff-run.'),
		('rubio', 'twitter'::platform, 'https://x.com/SecRubio', 'Official government account. The August 14 audit marked this match likely; monitor the first collection.'),
		('desantis', 'twitter'::platform, 'https://x.com/GovRonDeSantis', 'Official government account.'),
		('cruz', 'instagram'::platform, 'https://www.instagram.com/sentedcruz/', 'Official congressional account.'),
		('cruz', 'twitter'::platform, 'https://x.com/SenTedCruz', 'Official congressional account.'),
		('randpaul', 'twitter'::platform, 'https://x.com/SenRandPaul', 'Official congressional account.'),
		('ramaswamy', 'truth_social'::platform, 'https://truthsocial.com/@VivekRamaswamy', 'Candidate-controlled Truth Social account confirmed from the candidate''s official channel links.'),
		('kemp', 'twitter'::platform, 'https://x.com/govkemp', 'Official government account.')
)
INSERT INTO "election_profile_sources" (
	"candidate_id", "platform", "url", "status", "note"
)
SELECT ec."id", supplied."platform", supplied."url", 'pending', supplied."note"
FROM supplied
JOIN roster ON roster."candidate_key" = supplied."candidate_key"
JOIN "companies" c ON c."slug" = roster."slug"
JOIN "election_candidates" ec ON ec."company_id" = c."id"
JOIN "election_races" er ON er."id" = ec."race_id"
WHERE er."slug" = '2028-presidential-watchlist'
ON CONFLICT ("candidate_id", "platform", "url") DO UPDATE SET
	"note" = EXCLUDED."note",
	"updated_at" = now();--> statement-breakpoint

-- Sources sent to review by a temporary resolver failure before this roster
-- correction should get one clean automatic attempt. Identity conflicts will
-- return to review through the normal guarded connector.
UPDATE "election_profile_sources" eps
SET "status" = 'pending', "updated_at" = now()
FROM "election_candidates" ec
JOIN "election_races" er ON er."id" = ec."race_id"
WHERE eps."candidate_id" = ec."id"
  AND er."slug" = '2028-presidential-watchlist'
  AND eps."status" IN ('review', 'error');
