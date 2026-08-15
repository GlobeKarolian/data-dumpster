-- Correct three stale supplied URLs and retain JD Vance's verified office Page
-- as a second, distinct Facebook source. These are editorial roster fixes; the
-- platform adapters still resolve stable identities before observations land.

UPDATE "election_profile_sources" eps
   SET "url" = 'https://www.instagram.com/pete.buttigieg/',
       "status" = 'pending',
       "channel_id" = NULL,
       "note" = 'Corrected to Pete Buttigieg''s active public Instagram handle.',
       "updated_at" = now()
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE eps."candidate_id" = ec."id"
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'Pete Buttigieg'
   AND eps."platform" = 'instagram'
   AND eps."url" = 'https://www.instagram.com/petebuttigieg/';

UPDATE "election_profile_sources" eps
   SET "url" = 'https://www.youtube.com/@senbooker',
       "status" = 'pending',
       "channel_id" = NULL,
       "note" = 'Current official U.S. Senate YouTube handle.',
       "updated_at" = now()
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE eps."candidate_id" = ec."id"
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'Cory Booker'
   AND eps."platform" = 'youtube'
   AND eps."url" = 'https://www.youtube.com/@SenCoryBooker';

UPDATE "election_profile_sources" eps
   SET "url" = 'https://www.youtube.com/@senatorrandpaulky',
       "status" = 'pending',
       "channel_id" = NULL,
       "note" = 'Current official U.S. Senate YouTube handle.',
       "updated_at" = now()
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE eps."candidate_id" = ec."id"
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'Rand Paul'
   AND eps."platform" = 'youtube'
   AND eps."url" = 'https://www.youtube.com/@SenatorRandPaul';

UPDATE "election_profile_sources" eps
   SET "status" = 'pending',
       "channel_id" = NULL,
       "note" = 'Numeric-backed JD Vance public Facebook profile.',
       "updated_at" = now()
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE eps."candidate_id" = ec."id"
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'JD Vance'
   AND eps."platform" = 'facebook'
   AND eps."url" = 'https://www.facebook.com/p/JD-Vance-100070055152736/';

INSERT INTO "election_profile_sources" (
  "candidate_id", "platform", "url", "status", "note"
)
SELECT ec."id", 'facebook', 'https://www.facebook.com/VicePresident/', 'pending',
       'Verified official Vice President Facebook Page.'
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'JD Vance'
ON CONFLICT ("candidate_id", "platform", "url") DO NOTHING;
