-- Bright Data's combined Facebook Page-and-profile resolver currently marks
-- Pete Buttigieg's live vanity URL as a dead page. Preserve the stable Page id
-- already established by public Page permalinks and Meta Ad Library links so
-- the account remains attached to the correct pooled identity while the
-- vendor-specific availability issue is reported honestly.
UPDATE "channels" ch
   SET "external_id" = '1039701332716228',
       "updated_at" = now()
  FROM "companies" c
  JOIN "election_candidates" ec ON ec."company_id" = c."id"
  JOIN "election_races" er ON er."id" = ec."race_id"
 WHERE ch."company_id" = c."id"
   AND ch."platform" = 'facebook'
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'Pete Buttigieg'
   AND ch."external_id" IS NULL
   AND ch."profile_url" IN (
     'https://www.facebook.com/petebuttigieg/',
     'https://facebook.com/petebuttigieg/',
     'https://www.facebook.com/petebuttigieg1/',
     'https://facebook.com/petebuttigieg1/'
   );--> statement-breakpoint

UPDATE "election_profile_sources" eps
   SET "note" = 'Stable Facebook Page id 1039701332716228 confirmed from public Page permalinks and Meta Ad Library references. Bright Data currently reports the live vanity URL as unavailable.',
       "updated_at" = now()
  FROM "election_candidates" ec
  JOIN "election_races" er ON er."id" = ec."race_id"
  JOIN "companies" c ON c."id" = ec."company_id"
 WHERE eps."candidate_id" = ec."id"
   AND eps."platform" = 'facebook'
   AND er."slug" = '2028-presidential-watchlist'
   AND c."name" = 'Pete Buttigieg';
