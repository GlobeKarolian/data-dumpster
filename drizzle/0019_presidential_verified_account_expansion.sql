-- Expand the 2028 newsroom watchlist with public accounts verified on
-- 2026-08-15. Threads identities were resolved against Bright Data's live
-- profile dataset; Facebook and Instagram URLs were corroborated by current
-- official or verified candidate directories; YouTube channel ids were
-- resolved through the YouTube Data API. Office and personal accounts remain
-- distinct because both contribute to a candidate's public social presence.
WITH roster("candidate_key", "slug") AS (
	VALUES
		('newsom', 'gavin-newsom'),
		('harris', 'kamala-harris'),
		('buttigieg', 'pete-buttigieg'),
		('ocasio', 'alexandria-ocasio-cortez'),
		('shapiro', 'josh-shapiro'),
		('beshear', 'andy-beshear'),
		('pritzker', 'jb-pritzker'),
		('kelly', 'mark-kelly'),
		('booker', 'cory-booker'),
		('khanna', 'ro-khanna'),
		('vance', 'jd-vance'),
		('rubio', 'marco-rubio'),
		('cruz', 'ted-cruz'),
		('trumpjr', 'donald-trump-jr'),
		('ramaswamy', 'vivek-ramaswamy'),
		('youngkin', 'glenn-youngkin'),
		('sanders', 'sarah-huckabee-sanders')
), supplied("candidate_key", "platform", "url", "note") AS (
	VALUES
		('newsom', 'threads'::platform, 'https://www.threads.com/@gavinnewsom', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63418223229 on 2026-08-15.'),
		('newsom', 'threads'::platform, 'https://www.threads.com/@cagovernor', 'Official California governor Threads account. Bright Data resolved stable profile id 63068973319 on 2026-08-15.'),
		('harris', 'threads'::platform, 'https://www.threads.com/@kamalaharris', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63001388803 on 2026-08-15.'),
		('buttigieg', 'threads'::platform, 'https://www.threads.com/@pete.buttigieg', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63086060487 on 2026-08-15.'),
		('ocasio', 'threads'::platform, 'https://www.threads.com/@aoc', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63674704096 on 2026-08-15.'),
		('ocasio', 'threads'::platform, 'https://www.threads.com/@repaoc', 'Official congressional Threads account. Bright Data resolved stable profile id 63086049755 on 2026-08-15.'),
		('shapiro', 'threads'::platform, 'https://www.threads.com/@governorshapiro', 'Official Pennsylvania governor Threads account. Bright Data resolved stable profile id 63418518290 on 2026-08-15.'),
		('shapiro', 'threads'::platform, 'https://www.threads.com/@joshshapiropa', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63091552968 on 2026-08-15.'),
		('beshear', 'threads'::platform, 'https://www.threads.com/@govandybeshear', 'Official Kentucky governor Threads account. Bright Data resolved stable profile id 63413093690 on 2026-08-15.'),
		('beshear', 'threads'::platform, 'https://www.threads.com/@andybeshearky', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63230276466 on 2026-08-15.'),
		('pritzker', 'threads'::platform, 'https://www.threads.com/@govpritzker', 'Official Illinois governor Threads account. Bright Data resolved stable profile id 63369588909 on 2026-08-15.'),
		('pritzker', 'threads'::platform, 'https://www.threads.com/@jbpritzker', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 70284780197 on 2026-08-15.'),
		('kelly', 'threads'::platform, 'https://www.threads.com/@captmarkkelly', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 72379770060 on 2026-08-15.'),
		('booker', 'threads'::platform, 'https://www.threads.com/@senbooker', 'Official congressional Threads account. Bright Data resolved stable profile id 63412270734 on 2026-08-15.'),
		('khanna', 'threads'::platform, 'https://www.threads.com/@reprokhanna', 'Official congressional Threads account. Bright Data resolved stable profile id 63612800207 on 2026-08-15.'),
		('rubio', 'threads'::platform, 'https://www.threads.com/@marcorubio', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63073860687 on 2026-08-15.'),
		('cruz', 'threads'::platform, 'https://www.threads.com/@tedcruz', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63310290029 on 2026-08-15.'),
		('cruz', 'threads'::platform, 'https://www.threads.com/@sentedcruz', 'Official congressional Threads account. Bright Data resolved stable profile id 63021431078 on 2026-08-15.'),
		('trumpjr', 'threads'::platform, 'https://www.threads.com/@donaldjtrumpjr', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63121374145 on 2026-08-15.'),
		('ramaswamy', 'threads'::platform, 'https://www.threads.com/@vivekgramaswamy', 'Candidate-controlled Threads account. Bright Data resolved stable profile id 63397850681 on 2026-08-15.'),

		('youngkin', 'facebook'::platform, 'https://www.facebook.com/GlennYoungkin/', 'Verified public Glenn Youngkin Facebook Page.'),
		('youngkin', 'instagram'::platform, 'https://www.instagram.com/glennyoungkin/', 'Verified public Glenn Youngkin Instagram account.'),
		('youngkin', 'youtube'::platform, 'https://www.youtube.com/channel/UCXDaskT5bI9dPATMMMH9YEg', 'Official Glenn Youngkin YouTube channel; stable channel id resolved through the YouTube Data API.'),
		('sanders', 'instagram'::platform, 'https://www.instagram.com/sarahhuckabeesanders/', 'Verified public Sarah Huckabee Sanders Instagram account.'),
		('sanders', 'youtube'::platform, 'https://www.youtube.com/channel/UCUDUSYr28mICe7sNu-Tyqgw', 'Sarah for Governor YouTube channel embedded by the current campaign website; stable channel id resolved through the YouTube Data API.'),
		('trumpjr', 'facebook'::platform, 'https://www.facebook.com/DonaldJTrumpJr/', 'Verified public Donald Trump Jr. Facebook Page.'),
		('rubio', 'youtube'::platform, 'https://www.youtube.com/channel/UCS3pMFB7C_BujEG5xaQIZzw', 'Marco Rubio public YouTube channel; stable channel id resolved through the YouTube Data API.'),
		('rubio', 'youtube'::platform, 'https://www.youtube.com/channel/UCh8t7sV_DBKz4A-RkL9feyg', 'Official U.S. Senate YouTube archive for Marco Rubio; stable channel id resolved through the YouTube Data API.'),

		('vance', 'truth_social'::platform, 'https://truthsocial.com/@JDVance1', 'Known candidate-controlled Truth Social account from the newsroom account audit.'),
		('rubio', 'truth_social'::platform, 'https://truthsocial.com/@marcorubio', 'Known candidate-controlled Truth Social account from the newsroom account audit and official public directory.'),
		('trumpjr', 'truth_social'::platform, 'https://truthsocial.com/@DonaldJTrumpJr', 'Known candidate-controlled Truth Social account from the newsroom account audit.'),
		('ramaswamy', 'truth_social'::platform, 'https://truthsocial.com/@VivekRamaswamy', 'Known candidate-controlled Truth Social account from the candidate''s official channel links.')
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
	"status" = CASE
		WHEN "election_profile_sources"."status" = 'connected' THEN 'connected'
		ELSE 'pending'
	END,
	"channel_id" = CASE
		WHEN "election_profile_sources"."status" = 'connected' THEN "election_profile_sources"."channel_id"
		ELSE NULL
	END,
	"note" = EXCLUDED."note",
	"updated_at" = now();
