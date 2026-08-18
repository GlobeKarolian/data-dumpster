/**
 * Seed the Boston Globe Media tag taxonomy, 18 August 2026.
 *
 * The operator wiped the original flat taxonomy to start fresh with depth:
 * general categories AND the specific topics under them, applied together by
 * the tagger's stacking rules. Player tags were chosen by mention volume in
 * the last 30 days of actual coverage (tmp/mentions.ts), not by guesswork,
 * and their definitions are roster-independent on purpose — "the baseball
 * player", not "the Red Sox first baseman" — so a trade does not stale a
 * definition. Quiet subjects (NHL players in August) are deliberately absent:
 * the curator creates them when coverage arrives, which is the system working,
 * not a gap.
 *
 * Idempotent: existing (org, name) tags are left untouched, scopes are
 * inserted with ON CONFLICT DO NOTHING. Run:
 *   npx tsx --env-file=.env.local scripts/seed-taxonomy.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

const ORG = 'a7bda3ab-9056-499f-a3e8-72a237a364c8';

type Scope = 'news' | 'mlb' | 'news+mlb';
interface Seed { name: string; color: string; scope: Scope; def: string }

const STACK = 'Apply together with every other tag that fits; specific tags ride along with general ones.';

const SEEDS: Seed[] = [
  /* ------------------------------------------------ beats (news) */
  {
    name: 'Breaking News', color: '#DC2626', scope: 'news',
    def: 'Urgent, unfolding events: crashes, fires, shootings, explosions, evacuations, manhunts, live updates on something happening right now. NOT scheduled events, game results, ordinary weather, or follow-up coverage days later. ' + STACK,
  },
  {
    name: 'Politics', color: '#4F46E5', scope: 'news',
    def: 'Government and politics: elections, campaigns, legislation, officials acting in office, the State House, City Hall, Congress, the White House. NOT court cases without a political actor, and NOT business regulation stories unless the politics is the story. ' + STACK,
  },
  {
    name: 'Opinion', color: '#9333EA', scope: 'news',
    def: 'Opinion journalism: op-eds, editorials, columns, letters to the editor, and posts explicitly framed as a writer’s stance or argument. NOT straight news reporting, even on controversial subjects.',
  },
  {
    name: 'Food & Dining', color: '#EA580C', scope: 'news',
    def: 'Restaurants, bars, cafes, chefs, openings and closings, food events, recipes, dining guides and reviews. A restaurant-industry business story (a chain’s bankruptcy, a labor dispute) also carries Business. ' + STACK,
  },
  {
    name: 'Business', color: '#0369A1', scope: 'news',
    def: 'Companies and the economy: deals, earnings, layoffs, startups, executives, commercial development, industry trends, consumer prices. Apply the matching industry tag with it (Biotech & Pharma, Artificial Intelligence, Banking & Finance, and so on) whenever one fits. ' + STACK,
  },
  {
    name: 'Sports', color: '#16A34A', scope: 'news',
    def: 'Sports at any level: games, athletes, trades, injuries, coaching, recruiting, fandom. Always apply the sport tag with it, the team tag when a team is the subject, and the player tag when a defined player is the subject. ' + STACK,
  },
  {
    name: 'Weather', color: '#0891B2', scope: 'news',
    def: 'Forecasts, storms, heat and cold, flooding, snow totals, and closures or disruptions driven by weather. A destructive storm as it happens is also Breaking News. ' + STACK,
  },
  {
    name: 'Arts & Culture', color: '#DB2777', scope: 'news',
    def: 'Museums, music, theater, film, television, books, festivals, and the people who make them. NOT celebrity crime or celebrity business stories, which belong to those beats. ' + STACK,
  },
  {
    name: 'Crime & Courts', color: '#B91C1C', scope: 'news',
    def: 'Crimes, arrests, investigations, charges, trials, verdicts, sentencing, and police or prosecutor activity. NOT political scandals without charges, and NOT opinion about crime policy, which is Opinion plus Politics. ' + STACK,
  },
  {
    name: 'Education & Higher Ed', color: '#6D28D9', scope: 'news',
    def: 'Schools, colleges and universities as institutions: admissions, funding, campus news, teachers and faculty, school committees, student life. A university research finding is this tag only when the institution is the story. ' + STACK,
  },
  {
    name: 'Transit & MBTA', color: '#F59E0B', scope: 'news',
    def: 'The T, commuter rail, buses, ferries, Logan Airport, highways and traffic as policy or failure: delays, derailments, fares, funding, construction. NOT an ordinary crash on a road, which is Breaking News. ' + STACK,
  },

  /* ------------------------------------------------ running stories (news) */
  {
    name: 'Lindsay Clancy', color: '#7C3AED', scope: 'news',
    def: 'The Lindsay Clancy case: the trial, testimony, attorneys, verdict, and reactions to it, plus coverage of the case’s issues (postpartum mental health as trial context). Apply Crime & Courts with it. NOT unrelated postpartum health stories. ' + STACK,
  },
  {
    name: 'Trump', color: '#DC2626', scope: 'news',
    def: 'Donald Trump as the subject or a central actor: statements, orders, appearances, legal matters, administration decisions he owns. NOT every federal government story; a cabinet agency acting without him is Politics alone. ' + STACK,
  },
  {
    name: 'Maura Healey', color: '#0D9488', scope: 'news',
    def: 'Governor Maura Healey when she is named or is clearly the actor: statements, decisions, signings, vetoes, appearances, criticism aimed at her. NOT Massachusetts state government stories where she plays no part. ' + STACK,
  },

  /* ------------------------------------------------ sports family (news) */
  {
    name: 'Baseball', color: '#15803D', scope: 'news',
    def: 'The sport of baseball at any level: MLB, college, high school, international. Apply Sports with it, and the team and player tags when they fit. ' + STACK,
  },
  {
    name: 'Football', color: '#166534', scope: 'news',
    def: 'The sport of football: NFL and college. Apply Sports with it, and the team and player tags when they fit. ' + STACK,
  },
  {
    name: 'Basketball', color: '#14532D', scope: 'news',
    def: 'The sport of basketball: NBA, WNBA, college. Apply Sports with it, and the team and player tags when they fit. ' + STACK,
  },
  {
    name: 'Hockey', color: '#065F46', scope: 'news',
    def: 'The sport of hockey: NHL, college, juniors. Apply Sports with it, and the team and player tags when they fit. ' + STACK,
  },
  {
    name: 'Soccer', color: '#047857', scope: 'news',
    def: 'The sport of soccer: MLS, NWSL, international and European club football. Apply Sports with it, and the team and player tags when they fit. ' + STACK,
  },
  {
    name: 'College Sports', color: '#059669', scope: 'news',
    def: 'College athletics programs and athletes as the subject: recruiting, NIL, conference news, campus teams. Apply Sports and the sport’s own tag with it. ' + STACK,
  },

  /* ------------------------------------------------ teams (news) */
  {
    name: 'Red Sox', color: '#BD3039', scope: 'news',
    def: 'The Boston Red Sox, including "Sox" shorthand: games, roster moves, ownership, prospects, Fenway as a baseball venue. Apply Sports and Baseball with it, and the player tag when a defined player is the subject. ' + STACK,
  },
  {
    name: 'Patriots', color: '#002244', scope: 'news',
    def: 'The New England Patriots, including "Pats": games, roster, coaching, Gillette as a football venue. Apply Sports and Football with it, and the player tag when a defined player is the subject. ' + STACK,
  },
  {
    name: 'Celtics', color: '#007A33', scope: 'news',
    def: 'The Boston Celtics: games, roster, ownership, TD Garden as a basketball venue. Apply Sports and Basketball with it, and the player tag when a defined player is the subject. ' + STACK,
  },
  {
    name: 'Bruins', color: '#FFB81C', scope: 'news',
    def: 'The Boston Bruins: games, roster, coaching, TD Garden as a hockey venue. Apply Sports and Hockey with it. ' + STACK,
  },
  {
    name: 'Revolution', color: '#C63323', scope: 'news',
    def: 'The New England Revolution: games, roster, coaching, Gillette as a soccer venue. Apply Sports and Soccer with it. ' + STACK,
  },

  /* ------------------------------------- players and coaches (by coverage volume) */
  {
    name: 'Christian Gonzalez', color: '#64748B', scope: 'news',
    def: 'Christian Gonzalez, the NFL cornerback: performance, injuries, contract, off-field news. Apply Sports, Football and Patriots with it. NOT other people who share the name. ' + STACK,
  },
  {
    name: 'Drake Maye', color: '#64748B', scope: 'news',
    def: 'Drake Maye, the NFL quarterback: performance, injuries, development, off-field news. Apply Sports, Football and Patriots with it. ' + STACK,
  },
  {
    name: 'Mike Vrabel', color: '#64748B', scope: 'news',
    def: 'Mike Vrabel, the NFL head coach: decisions, quotes, staff moves. Apply Sports, Football and Patriots with it. ' + STACK,
  },
  {
    name: 'Hunter Henry', color: '#64748B', scope: 'news',
    def: 'Hunter Henry, the NFL tight end. Apply Sports, Football and Patriots with it. ' + STACK,
  },
  {
    name: 'Jaylen Brown', color: '#64748B', scope: 'news',
    def: 'Jaylen Brown, the NBA player: performance, injuries, contract, business and community work. Apply Sports, Basketball and Celtics with it. ' + STACK,
  },
  {
    name: 'Jayson Tatum', color: '#64748B', scope: 'news',
    def: 'Jayson Tatum, the NBA player: rehab, return, performance, off-court news. Apply Sports, Basketball and Celtics with it. ' + STACK,
  },
  {
    name: 'Ceddanne Rafaela', color: '#64748B', scope: 'news+mlb',
    def: 'Ceddanne Rafaela, the baseball player: performance, highlights, injuries. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Jarren Duran', color: '#64748B', scope: 'news+mlb',
    def: 'Jarren Duran, the baseball player: performance, trade talk, off-field news. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Wilyer Abreu', color: '#64748B', scope: 'news+mlb',
    def: 'Wilyer Abreu, the baseball player. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Roman Anthony', color: '#64748B', scope: 'news+mlb',
    def: 'Roman Anthony, the baseball player: performance, development, milestones. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Trevor Story', color: '#64748B', scope: 'news+mlb',
    def: 'Trevor Story, the baseball player. Apply Sports and Baseball with it, and the team tag where defined. NOT the common phrase "trevor story" appearing about other people. ' + STACK,
  },
  {
    name: 'Garrett Crochet', color: '#64748B', scope: 'news+mlb',
    def: 'Garrett Crochet, the baseball pitcher: starts, performance, contract. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Connor Wong', color: '#64748B', scope: 'news+mlb',
    def: 'Connor Wong, the baseball player. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Aroldis Chapman', color: '#64748B', scope: 'news+mlb',
    def: 'Aroldis Chapman, the baseball pitcher. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Marcelo Mayer', color: '#64748B', scope: 'news+mlb',
    def: 'Marcelo Mayer, the baseball player: development, call-ups, performance. Apply Sports and Baseball with it, and the team tag where defined. ' + STACK,
  },
  {
    name: 'Shohei Ohtani', color: '#64748B', scope: 'mlb',
    def: 'Shohei Ohtani, the baseball player: two-way performances, milestones, endorsements. Apply the fitting MLB category tags with it. ' + STACK,
  },
  {
    name: 'Bobby Witt Jr.', color: '#64748B', scope: 'mlb',
    def: 'Bobby Witt Jr., the baseball player. Apply the fitting MLB category tags with it. ' + STACK,
  },
  {
    name: 'Tarik Skubal', color: '#64748B', scope: 'mlb',
    def: 'Tarik Skubal, the baseball pitcher. Apply the fitting MLB category tags with it. ' + STACK,
  },
  {
    name: 'Vladimir Guerrero Jr.', color: '#64748B', scope: 'mlb',
    def: 'Vladimir Guerrero Jr., the baseball player. Apply the fitting MLB category tags with it. ' + STACK,
  },
  {
    name: 'Cal Raleigh', color: '#64748B', scope: 'mlb',
    def: 'Cal Raleigh, the baseball player: home run chase, catching, milestones. Apply the fitting MLB category tags with it. ' + STACK,
  },

  /* ------------------------------------------------ business family (news) */
  {
    name: 'Biotech & Pharma', color: '#0E7490', scope: 'news',
    def: 'Drug developers, medical device makers, lab space, FDA milestones, biotech funding and layoffs — the Kendall Square economy. Apply Business with it. A hospital story is Healthcare, not this. ' + STACK,
  },
  {
    name: 'Artificial Intelligence', color: '#1D4ED8', scope: 'news',
    def: 'AI as the subject: companies, products, research, adoption, jobs impact, policy and safety debates. Apply Business with it for company stories; a pure policy fight is Politics too. ' + STACK,
  },
  {
    name: 'Technology', color: '#2563EB', scope: 'news',
    def: 'Technology companies and products beyond AI: software, hardware, platforms, telecom, cybersecurity. Apply Business with it. ' + STACK,
  },
  {
    name: 'Banking & Finance', color: '#1E40AF', scope: 'news',
    def: 'Banks, investment firms, venture capital, private equity, markets, fintech, interest rates and lending. Apply Business with it. ' + STACK,
  },
  {
    name: 'Real Estate & Housing', color: '#3730A3', scope: 'news',
    def: 'Development, the housing market, rents, zoning, evictions, commercial real estate, construction. Apply Business with it for market and developer stories; a zoning fight at City Hall is also Politics. ' + STACK,
  },
  {
    name: 'Healthcare', color: '#0F766E', scope: 'news',
    def: 'Hospitals, health systems, insurers and care delivery as institutions: finances, staffing, closures, access, costs. Apply Business with it when the story is corporate. NOT individual medical advice content. ' + STACK,
  },
  {
    name: 'Energy & Utilities', color: '#4338CA', scope: 'news',
    def: 'Utilities, the grid, offshore wind, gas and electric rates, pipelines, energy projects and their fights. Apply Business with it. ' + STACK,
  },
  {
    name: 'Labor & Unions', color: '#5B21B6', scope: 'news',
    def: 'Strikes, contract fights, organizing drives, and layoffs framed as labor action. Apply Business with it, and the industry tag of the employer when one fits. ' + STACK,
  },
  {
    name: 'Retail', color: '#1E3A8A', scope: 'news',
    def: 'Retailers, chains, malls, consumer trends, store openings and closings. Apply Business with it. A restaurant-chain story carries Food & Dining too. ' + STACK,
  },

  /* ------------------------------------------------ MLB landscape set */
  {
    name: 'Trades & Free Agency', color: '#B45309', scope: 'mlb',
    def: 'Trades, signings, rumors, deadlines, contracts and extensions. NOT minor-league call-ups, which are Prospects & Farm. ' + STACK,
  },
  {
    name: 'Injuries & IL', color: '#92400E', scope: 'mlb',
    def: 'Injuries, IL stints, rehab assignments and returns. ' + STACK,
  },
  {
    name: 'Postseason Race', color: '#A16207', scope: 'mlb',
    def: 'Standings, wild card races, magic numbers, clinching and elimination. ' + STACK,
  },
  {
    name: 'Home Runs & Highlights', color: '#D97706', scope: 'mlb',
    def: 'Home run calls, walk-offs, spectacular defensive plays, viral in-game moments. ' + STACK,
  },
  {
    name: 'Pitching', color: '#78350F', scope: 'mlb',
    def: 'Pitching performances and pitching news: gems, no-hitter watches, rotation and bullpen moves. ' + STACK,
  },
  {
    name: 'Prospects & Farm', color: '#854D0E', scope: 'mlb',
    def: 'Minor leaguers, call-ups, the draft, player development. ' + STACK,
  },
  {
    name: 'Milestones & Records', color: '#CA8A04', scope: 'mlb',
    def: 'Career milestones, franchise records, historic firsts, award chases. ' + STACK,
  },
];

async function main() {
  const { rows: landscapes } = await db.execute<{ id: string; name: string }>(sql`
    SELECT id::text, name FROM landscapes WHERE org_id = ${ORG}`);
  const mlbIds = landscapes.filter((l) => /mlb/i.test(l.name)).map((l) => l.id);
  const newsIds = landscapes
    .filter((l) => !/mlb|election|presidential|watchlist/i.test(l.name))
    .map((l) => l.id);
  console.log(`landscapes: ${newsIds.length} news, ${mlbIds.length} mlb, ${landscapes.length} total`);
  if (newsIds.length === 0 || mlbIds.length === 0) throw new Error('landscape classification failed');

  let created = 0;
  let skipped = 0;
  for (const seed of SEEDS) {
    const existing = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM post_tags WHERE org_id = ${ORG} AND lower(name) = lower(${seed.name})`);
    if (existing.rows.length > 0) { skipped += 1; continue; }

    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO post_tags (org_id, name, color, ai_prompt)
      VALUES (${ORG}, ${seed.name}, ${seed.color}, ${seed.def})
      RETURNING id::text`);
    const tagId = inserted.rows[0].id;

    const scopeIds = seed.scope === 'news' ? newsIds
      : seed.scope === 'mlb' ? mlbIds
      : [...newsIds, ...mlbIds];
    for (const landscapeId of scopeIds) {
      await db.execute(sql`
        INSERT INTO post_tag_landscapes (tag_id, landscape_id)
        VALUES (${tagId}, ${landscapeId})
        ON CONFLICT DO NOTHING`);
    }
    created += 1;
  }

  const { rows: count } = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n FROM post_tags WHERE org_id = ${ORG}`);
  const { rows: scopes } = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n FROM post_tag_landscapes ptl
     JOIN post_tags t ON t.id = ptl.tag_id WHERE t.org_id = ${ORG}`);
  console.log(`created ${created}, skipped ${skipped} existing; org now has ${count[0].n} tags, ${scopes[0].n} scope rows`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
