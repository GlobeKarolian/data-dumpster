-- Build the first national Election Center watchlist from the newsroom's
-- account audit dated 2026-08-14. Inclusion is editorial watchlist membership,
-- not a declaration of candidacy and not a polling judgment.
INSERT INTO "landscapes" ("org_id", "name", "slug", "description")
SELECT
	o."id",
	'2028 Presidential Tracker · 2028',
	'election-2028-presidential-watchlist',
	'Internal collection scope for the prospective 2028 presidential field.'
FROM "orgs" o
WHERE NOT EXISTS (
	SELECT 1 FROM "landscapes" l
	WHERE l."org_id" = o."id"
		AND l."slug" = 'election-2028-presidential-watchlist'
);--> statement-breakpoint

INSERT INTO "election_races" (
	"org_id", "landscape_id", "name", "slug", "office", "jurisdiction",
	"election_date", "status", "description"
)
SELECT
	l."org_id",
	l."id",
	'2028 Presidential Tracker',
	'2028-presidential-watchlist',
	'President of the United States',
	'United States',
	'2028-11-07'::date,
	'setup',
	'A newsroom watchlist of prospective 2028 presidential candidates. Inclusion does not mean a person has declared or will run. Social performance measures public attention, not voter intention.'
FROM "landscapes" l
WHERE l."slug" = 'election-2028-presidential-watchlist'
	AND NOT EXISTS (
		SELECT 1 FROM "election_races" er
		WHERE er."org_id" = l."org_id"
			AND er."slug" = '2028-presidential-watchlist'
	);--> statement-breakpoint

WITH roster("candidate_key", "slug", "name", "party", "role", "sort_order", "color") AS (
	VALUES
		('newsom', 'gavin-newsom', 'Gavin Newsom', 'Democratic', 'Governor of California', 0, '#0B5CAD'),
		('harris', 'kamala-harris', 'Kamala Harris', 'Democratic', 'Former U.S. vice president', 1, '#4F46E5'),
		('buttigieg', 'pete-buttigieg', 'Pete Buttigieg', 'Democratic', 'Former U.S. transportation secretary', 2, '#2563EB'),
		('ocasio', 'alexandria-ocasio-cortez', 'Alexandria Ocasio-Cortez', 'Democratic', 'U.S. representative, NY-14', 3, '#7C3AED'),
		('shapiro', 'josh-shapiro', 'Josh Shapiro', 'Democratic', 'Governor of Pennsylvania', 4, '#0284C7'),
		('beshear', 'andy-beshear', 'Andy Beshear', 'Democratic', 'Governor of Kentucky', 5, '#0369A1'),
		('pritzker', 'jb-pritzker', 'JB Pritzker', 'Democratic', 'Governor of Illinois', 6, '#1D4ED8'),
		('kelly', 'mark-kelly', 'Mark Kelly', 'Democratic', 'U.S. senator, Arizona', 7, '#0891B2'),
		('booker', 'cory-booker', 'Cory Booker', 'Democratic', 'U.S. senator, New Jersey', 8, '#4338CA'),
		('khanna', 'ro-khanna', 'Ro Khanna', 'Democratic', 'U.S. representative, CA-17', 9, '#0E7490'),
		('vance', 'jd-vance', 'JD Vance', 'Republican', 'Vice President of the United States', 10, '#B91C1C'),
		('rubio', 'marco-rubio', 'Marco Rubio', 'Republican', 'U.S. secretary of state', 11, '#DC2626'),
		('desantis', 'ron-desantis', 'Ron DeSantis', 'Republican', 'Governor of Florida', 12, '#C2410C'),
		('cruz', 'ted-cruz', 'Ted Cruz', 'Republican', 'U.S. senator, Texas', 13, '#991B1B'),
		('trumpjr', 'donald-trump-jr', 'Donald Trump Jr.', 'Republican', 'Trump Organization executive VP', 14, '#7F1D1D'),
		('randpaul', 'rand-paul', 'Rand Paul', 'Republican', 'U.S. senator, Kentucky', 15, '#EA580C'),
		('ramaswamy', 'vivek-ramaswamy', 'Vivek Ramaswamy', 'Republican', '2026 GOP nominee for Ohio governor', 16, '#F97316'),
		('youngkin', 'glenn-youngkin', 'Glenn Youngkin', 'Republican', 'Former governor of Virginia', 17, '#BE123C'),
		('kemp', 'brian-kemp', 'Brian Kemp', 'Republican', 'Governor of Georgia', 18, '#C02626'),
		('sanders', 'sarah-huckabee-sanders', 'Sarah Huckabee Sanders', 'Republican', 'Governor of Arkansas', 19, '#9F1239')
)
INSERT INTO "companies" ("org_id", "name", "slug", "segment", "color")
SELECT o."id", roster."name", roster."slug", roster."role", roster."color"
FROM roster
CROSS JOIN LATERAL (
	SELECT "id" FROM "orgs" ORDER BY "created_at" LIMIT 1
) o
ON CONFLICT ("slug") DO UPDATE SET
	"name" = EXCLUDED."name",
	"segment" = EXCLUDED."segment",
	"color" = EXCLUDED."color";--> statement-breakpoint

WITH roster("slug", "sort_order") AS (
	VALUES
		('gavin-newsom', 0), ('kamala-harris', 1), ('pete-buttigieg', 2),
		('alexandria-ocasio-cortez', 3), ('josh-shapiro', 4), ('andy-beshear', 5),
		('jb-pritzker', 6), ('mark-kelly', 7), ('cory-booker', 8), ('ro-khanna', 9),
		('jd-vance', 10), ('marco-rubio', 11), ('ron-desantis', 12), ('ted-cruz', 13),
		('donald-trump-jr', 14), ('rand-paul', 15), ('vivek-ramaswamy', 16),
		('glenn-youngkin', 17), ('brian-kemp', 18), ('sarah-huckabee-sanders', 19)
)
INSERT INTO "landscape_companies" ("landscape_id", "company_id", "sort_order")
SELECT er."landscape_id", c."id", roster."sort_order"
FROM "election_races" er
CROSS JOIN roster
JOIN "companies" c ON c."slug" = roster."slug"
WHERE er."slug" = '2028-presidential-watchlist'
ON CONFLICT ("landscape_id", "company_id") DO UPDATE SET
	"sort_order" = EXCLUDED."sort_order";--> statement-breakpoint

WITH roster("slug", "party") AS (
	VALUES
		('gavin-newsom', 'Democratic'), ('kamala-harris', 'Democratic'),
		('pete-buttigieg', 'Democratic'), ('alexandria-ocasio-cortez', 'Democratic'),
		('josh-shapiro', 'Democratic'), ('andy-beshear', 'Democratic'),
		('jb-pritzker', 'Democratic'), ('mark-kelly', 'Democratic'),
		('cory-booker', 'Democratic'), ('ro-khanna', 'Democratic'),
		('jd-vance', 'Republican'), ('marco-rubio', 'Republican'),
		('ron-desantis', 'Republican'), ('ted-cruz', 'Republican'),
		('donald-trump-jr', 'Republican'), ('rand-paul', 'Republican'),
		('vivek-ramaswamy', 'Republican'), ('glenn-youngkin', 'Republican'),
		('brian-kemp', 'Republican'), ('sarah-huckabee-sanders', 'Republican')
)
INSERT INTO "election_candidates" (
	"race_id", "company_id", "party", "candidate_status", "incumbent"
)
SELECT er."id", c."id", roster."party", 'tracking', false
FROM "election_races" er
CROSS JOIN roster
JOIN "companies" c ON c."slug" = roster."slug"
WHERE er."slug" = '2028-presidential-watchlist'
ON CONFLICT ("race_id", "company_id") DO UPDATE SET
	"party" = EXCLUDED."party",
	"candidate_status" = EXCLUDED."candidate_status",
	"incumbent" = EXCLUDED."incumbent",
	"updated_at" = now();--> statement-breakpoint

WITH roster("candidate_key", "slug") AS (
	VALUES
		('newsom', 'gavin-newsom'), ('harris', 'kamala-harris'),
		('buttigieg', 'pete-buttigieg'), ('ocasio', 'alexandria-ocasio-cortez'),
		('shapiro', 'josh-shapiro'), ('beshear', 'andy-beshear'),
		('pritzker', 'jb-pritzker'), ('kelly', 'mark-kelly'),
		('booker', 'cory-booker'), ('khanna', 'ro-khanna'),
		('vance', 'jd-vance'), ('rubio', 'marco-rubio'),
		('desantis', 'ron-desantis'), ('cruz', 'ted-cruz'),
		('trumpjr', 'donald-trump-jr'), ('randpaul', 'rand-paul'),
		('ramaswamy', 'vivek-ramaswamy'), ('youngkin', 'glenn-youngkin'),
		('kemp', 'brian-kemp'), ('sanders', 'sarah-huckabee-sanders')
), supplied("candidate_key", "platform", "url", "status", "note") AS (
	VALUES
		('newsom', 'twitter'::platform, 'https://x.com/GavinNewsom', 'pending', NULL),
		('newsom', 'instagram'::platform, 'https://www.instagram.com/gavinnewsom/', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('newsom', 'facebook'::platform, 'https://www.facebook.com/CAgovernor/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('newsom', 'tiktok'::platform, 'https://www.tiktok.com/@gavinnewsom', 'pending', NULL),
		('newsom', 'youtube'::platform, 'https://www.youtube.com/@cagovernor', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('newsom', 'bluesky'::platform, 'https://bsky.app/profile/gavinnewsom.bsky.social', 'pending', 'Dormant. 2 posts total.'),
		('harris', 'twitter'::platform, 'https://x.com/KamalaHarris', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('harris', 'instagram'::platform, 'https://www.instagram.com/kamalaharris/', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('harris', 'facebook'::platform, 'https://www.facebook.com/KamalaHarris/', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('harris', 'tiktok'::platform, 'https://www.tiktok.com/@kamalaharris', 'pending', NULL),
		('harris', 'bluesky'::platform, 'https://bsky.app/profile/kamalaharris.com', 'pending', NULL),
		('buttigieg', 'twitter'::platform, 'https://x.com/PeteButtigieg', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('buttigieg', 'instagram'::platform, 'https://www.instagram.com/petebuttigieg/', 'pending', NULL),
		('buttigieg', 'facebook'::platform, 'https://www.facebook.com/petebuttigieg/', 'pending', NULL),
		('buttigieg', 'tiktok'::platform, 'https://www.tiktok.com/@petebuttigieg', 'pending', NULL),
		('buttigieg', 'youtube'::platform, 'https://www.youtube.com/@PeteButtigieg', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('buttigieg', 'bluesky'::platform, 'https://bsky.app/profile/petebuttigieg.bsky.social', 'pending', NULL),
		('ocasio', 'twitter'::platform, 'https://x.com/AOC', 'pending', NULL),
		('ocasio', 'instagram'::platform, 'https://www.instagram.com/aoc/', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('ocasio', 'facebook'::platform, 'https://www.facebook.com/repaoc/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('ocasio', 'tiktok'::platform, 'https://www.tiktok.com/@aoc', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('ocasio', 'bluesky'::platform, 'https://bsky.app/profile/aoc.bsky.social', 'pending', NULL),
		('shapiro', 'twitter'::platform, 'https://x.com/JoshShapiroPA', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('shapiro', 'instagram'::platform, 'https://www.instagram.com/GovernorShapiro/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('shapiro', 'facebook'::platform, 'https://www.facebook.com/governorshapiro/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('shapiro', 'youtube'::platform, 'https://www.youtube.com/@GovernorShapiro', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('shapiro', 'bluesky'::platform, 'https://bsky.app/profile/joshshapiropa.bsky.social', 'pending', NULL),
		('beshear', 'twitter'::platform, 'https://x.com/AndyBeshearKY', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('beshear', 'instagram'::platform, 'https://www.instagram.com/govandybeshear/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('beshear', 'facebook'::platform, 'https://www.facebook.com/GovAndyBeshear/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('beshear', 'youtube'::platform, 'https://www.youtube.com/@GovAndyBeshear', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('beshear', 'bluesky'::platform, 'https://bsky.app/profile/andybeshearky.bsky.social', 'pending', NULL),
		('pritzker', 'twitter'::platform, 'https://x.com/JBPritzker', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('pritzker', 'instagram'::platform, 'https://www.instagram.com/govpritzker/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('pritzker', 'facebook'::platform, 'https://www.facebook.com/GovPritzker/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('pritzker', 'bluesky'::platform, 'https://bsky.app/profile/jbpritzker.bsky.social', 'pending', NULL),
		('kelly', 'twitter'::platform, 'https://x.com/CaptMarkKelly', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('kelly', 'instagram'::platform, 'https://www.instagram.com/senmarkkelly/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('kelly', 'facebook'::platform, 'https://www.facebook.com/SenMarkKelly/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('kelly', 'youtube'::platform, 'https://www.youtube.com/@SenMarkKelly', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('kelly', 'bluesky'::platform, 'https://bsky.app/profile/captmarkkelly.bsky.social', 'pending', NULL),
		('booker', 'twitter'::platform, 'https://x.com/CoryBooker', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('booker', 'instagram'::platform, 'https://www.instagram.com/corybooker/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('booker', 'facebook'::platform, 'https://www.facebook.com/SenatorCoryBooker/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('booker', 'youtube'::platform, 'https://www.youtube.com/@SenCoryBooker', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('booker', 'bluesky'::platform, 'https://bsky.app/profile/corybooker.com', 'pending', NULL),
		('khanna', 'twitter'::platform, 'https://x.com/RoKhanna', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('khanna', 'instagram'::platform, 'https://www.instagram.com/reprokhanna/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('khanna', 'facebook'::platform, 'https://www.facebook.com/RepRoKhanna/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('khanna', 'bluesky'::platform, 'https://bsky.app/profile/rokhanna.bsky.social', 'pending', NULL),
		('vance', 'twitter'::platform, 'https://x.com/JDVance', 'pending', NULL),
		('vance', 'truth_social'::platform, 'https://truthsocial.com/@JDVance1', 'pending', NULL),
		('vance', 'instagram'::platform, 'https://www.instagram.com/jdvance/', 'pending', NULL),
		('vance', 'facebook'::platform, 'https://www.facebook.com/p/JD-Vance-100070055152736/', 'pending', NULL),
		('rubio', 'twitter'::platform, 'https://x.com/marcorubio', 'pending', NULL),
		('rubio', 'truth_social'::platform, 'https://truthsocial.com/@marcorubio', 'pending', NULL),
		('rubio', 'instagram'::platform, 'https://www.instagram.com/marcorubio/', 'pending', NULL),
		('rubio', 'facebook'::platform, 'https://www.facebook.com/marcorubio/', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('desantis', 'twitter'::platform, 'https://x.com/RonDeSantis', 'pending', NULL),
		('desantis', 'instagram'::platform, 'https://www.instagram.com/flgovrondesantis/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('desantis', 'facebook'::platform, 'https://www.facebook.com/GovRonDeSantis/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('cruz', 'twitter'::platform, 'https://x.com/tedcruz', 'pending', NULL),
		('cruz', 'instagram'::platform, 'https://www.instagram.com/tedcruz/', 'pending', NULL),
		('cruz', 'facebook'::platform, 'https://www.facebook.com/SenatorTedCruz/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('cruz', 'youtube'::platform, 'https://www.youtube.com/@sentedcruz', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('trumpjr', 'twitter'::platform, 'https://x.com/DonaldJTrumpJr', 'pending', NULL),
		('trumpjr', 'truth_social'::platform, 'https://truthsocial.com/@DonaldJTrumpJr', 'pending', NULL),
		('trumpjr', 'instagram'::platform, 'https://www.instagram.com/donaldjtrumpjr/', 'pending', NULL),
		('randpaul', 'twitter'::platform, 'https://x.com/RandPaul', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('randpaul', 'instagram'::platform, 'https://www.instagram.com/senatorrandpaul/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('randpaul', 'facebook'::platform, 'https://www.facebook.com/SenatorRandPaul/', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('randpaul', 'youtube'::platform, 'https://www.youtube.com/@SenatorRandPaul', 'pending', 'Official congressional account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('ramaswamy', 'twitter'::platform, 'https://x.com/VivekGRamaswamy', 'pending', 'Active campaign/team account selected as the primary political voice; it is not a declared 2028 presidential campaign.'),
		('ramaswamy', 'instagram'::platform, 'https://www.instagram.com/vivekgramaswamy/', 'pending', 'Active campaign/team account selected as the primary political voice; it is not a declared 2028 presidential campaign. The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('ramaswamy', 'facebook'::platform, 'https://www.facebook.com/VivekGRamaswamy/', 'pending', 'Active campaign/team account selected as the primary political voice; it is not a declared 2028 presidential campaign.'),
		('youngkin', 'twitter'::platform, 'https://x.com/GlennYoungkin', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('kemp', 'twitter'::platform, 'https://x.com/BrianKempGA', 'pending', 'The supplied account audit marked this match likely rather than independently verified; monitor the first collection.'),
		('kemp', 'instagram'::platform, 'https://www.instagram.com/govkemp/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('kemp', 'facebook'::platform, 'https://www.facebook.com/GovKemp/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('sanders', 'twitter'::platform, 'https://x.com/SarahHuckabee', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.'),
		('sanders', 'facebook'::platform, 'https://www.facebook.com/SarahHuckabeeSanders/', 'pending', 'Official government account selected as the primary source; it represents current-office communications, not a declared 2028 campaign.')
)
INSERT INTO "election_profile_sources" (
	"candidate_id", "platform", "url", "status", "note"
)
SELECT ec."id", supplied."platform", supplied."url", supplied."status", supplied."note"
FROM supplied
JOIN roster ON roster."candidate_key" = supplied."candidate_key"
JOIN "companies" c ON c."slug" = roster."slug"
JOIN "election_candidates" ec ON ec."company_id" = c."id"
JOIN "election_races" er ON er."id" = ec."race_id"
WHERE er."slug" = '2028-presidential-watchlist'
ON CONFLICT ("candidate_id", "platform") DO UPDATE SET
	"url" = EXCLUDED."url",
	"status" = CASE
		WHEN "election_profile_sources"."status" = 'connected' THEN 'connected'
		ELSE EXCLUDED."status"
	END,
	"note" = EXCLUDED."note",
	"updated_at" = now();--> statement-breakpoint

INSERT INTO "user_landscape_access" ("user_id", "landscape_id", "granted_by")
SELECT u."id", er."landscape_id", u."id"
FROM "election_races" er
JOIN "users" u ON u."org_id" = er."org_id"
WHERE er."slug" = '2028-presidential-watchlist'
ON CONFLICT ("user_id", "landscape_id") DO NOTHING;
