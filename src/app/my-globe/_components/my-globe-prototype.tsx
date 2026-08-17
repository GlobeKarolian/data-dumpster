'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  CircleUserRound,
  Compass,
  Gavel,
  House,
  ListFilter,
  LockKeyhole,
  Map,
  MessageCircle,
  Newspaper,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Star,
  Users,
  X,
  Zap,
} from 'lucide-react';
import styles from '../my-globe.module.css';

type HubId = 'camberville' | 'scrum' | 'gavel' | 'starting-point';
type View = 'home' | 'explore' | 'hub' | 'saved';
type HubSection = 'briefing' | 'tracker' | 'community';

type Hub = {
  id: HubId;
  shortName: string;
  name: string;
  category: string;
  cadence: string;
  promise: string;
  accent: string;
  accentSoft: string;
  issue: string;
  headline: string;
  dek: string;
  author: string;
  readTime: string;
  utilityName: string;
  utilityDescription: string;
  trackerTitle: string;
  trackerItems: Array<{ label: string; detail: string; status: string; progress: number }>;
  events: Array<{ time: string; title: string; place: string; member?: boolean }>;
  prompts: string[];
  answer: string;
};

const HUBS: Hub[] = [
  {
    id: 'camberville',
    shortName: 'Camberville',
    name: 'Camberville & Beyond',
    category: 'Your neighborhood',
    cadence: 'Weekly · Thursdays',
    promise: 'Know what is changing, what is opening, and what is worth leaving the house for.',
    accent: '#68b8cc',
    accentSoft: '#e4f3f6',
    issue: 'THE NEIGHBORHOOD EDITION · AUGUST 5',
    headline: 'A billion-dollar neighborhood is taking shape below Kendall Square',
    dek: 'The infrastructure you never see is remaking the blocks you walk every day. Here is what changes next—and when you will feel it.',
    author: 'Spencer Buell',
    readTime: '6 min read',
    utilityName: 'Development watch',
    utilityDescription: 'Follow the projects changing your blocks, with milestones instead of meeting minutes.',
    trackerTitle: 'What is changing near you',
    trackerItems: [
      { label: 'Kendall substation', detail: 'Utility work · Cambridge', status: 'Construction', progress: 72 },
      { label: 'McGrath Boulevard', detail: 'Street redesign · Somerville', status: 'Design review', progress: 44 },
      { label: 'Union Square parcels', detail: 'Mixed use · Somerville', status: 'Public comment', progress: 27 },
    ],
    events: [
      { time: '6:00 PM', title: 'Summer concert on the lawn', place: 'Cambridge Public Library' },
      { time: '6:30 PM', title: 'McGrath Boulevard open house', place: 'East Somerville School', member: true },
      { time: '8:00 PM', title: 'Outdoor movie: Jaws', place: 'Assembly Row' },
    ],
    prompts: ['What changed in Davis Square?', 'What should I know before Thursday?', 'Find a free event this weekend'],
    answer:
      'The short version: two restaurant openings, a bus-routing vote, and one construction detour. I would watch the Elm Street hearing Thursday—the proposal adds 84 homes and changes loading access near the plaza.',
  },
  {
    id: 'scrum',
    shortName: 'The Scrum',
    name: 'The Scrum',
    category: 'Massachusetts politics',
    cadence: 'Weekdays · 6:15 AM',
    promise: 'See what Beacon Hill is doing, who is driving it, and what it means before the day gets noisy.',
    accent: '#417449',
    accentSoft: '#e3eee4',
    issue: 'THE MORNING HUDDLE · AUGUST 5',
    headline: 'The formal session ended. The negotiating did not.',
    dek: 'Three bills are still moving behind the scenes. Here is the pressure map, the remaining calendar, and the people who can unlock a deal.',
    author: 'Kelly Garrity',
    readTime: '5 min read',
    utilityName: 'Bill board',
    utilityDescription: 'A plain-English tracker for the legislation that matters, updated as the votes move.',
    trackerTitle: 'Bills on the move',
    trackerItems: [
      { label: 'Housing production', detail: 'Conference committee', status: 'Negotiating', progress: 76 },
      { label: 'Energy affordability', detail: 'Awaiting Senate action', status: 'Stalled', progress: 48 },
      { label: 'Child care access', detail: 'Sent to governor', status: 'Enrolled', progress: 92 },
    ],
    events: [
      { time: '10:00 AM', title: 'Economic development hearing', place: 'Gardner Auditorium' },
      { time: '1:00 PM', title: 'Governor media availability', place: 'State House' },
      { time: '5:30 PM', title: 'Subscriber briefing with the politics team', place: 'Live online', member: true },
    ],
    prompts: ['Which bill is closest to passage?', 'Who is holding up housing?', 'What votes happen this week?'],
    answer:
      'Child care is closest: both chambers agreed and the bill is headed to the governor. Housing is the consequential watch. Negotiators agree on the target but not the local approval rules, which is why progress has slowed.',
  },
  {
    id: 'gavel',
    shortName: 'The Gavel',
    name: 'The Gavel',
    category: 'The Supreme Court',
    cadence: 'Weekly · Tuesdays',
    promise: 'Understand the Court without needing a law degree—or surrendering to the breaking-news churn.',
    accent: '#9b2f2f',
    accentSoft: '#f1e2df',
    issue: 'THE COURT IN CONTEXT · AUGUST 5',
    headline: 'The docket is quiet. The consequences are not.',
    dek: 'Four rulings from last term are now showing up in lower courts, statehouses, schools, and workplaces. Here is the impact map.',
    author: 'Kimberly Atkins Stohr',
    readTime: '7 min read',
    utilityName: 'Term tracker',
    utilityDescription: 'Track the cases, questions, arguments, and likely real-life consequences in one place.',
    trackerTitle: 'Cases to know',
    trackerItems: [
      { label: 'Voting rights', detail: 'Remand activity', status: 'Impact watch', progress: 68 },
      { label: 'Agency authority', detail: 'Lower-court tests', status: 'Developing', progress: 53 },
      { label: 'Online speech', detail: 'Petition pending', status: 'Cert watch', progress: 22 },
    ],
    events: [
      { time: '12:00 PM', title: 'Term debrief: what changed', place: 'Subscriber livestream', member: true },
      { time: '4:00 PM', title: 'Constitution Center case forum', place: 'Live online' },
      { time: '7:00 PM', title: 'Kimberly answers reader questions', place: 'Globe community room', member: true },
    ],
    prompts: ['Explain a ruling in plain English', 'Which case affects Massachusetts?', 'What happens before arguments?'],
    answer:
      'A case reaches arguments only after at least four justices vote to hear it. Before then, the briefs, lower-court record, and procedural posture matter. The Term Tracker puts those steps in order and flags the moment a case becomes consequential.',
  },
  {
    id: 'starting-point',
    shortName: 'Starting Point',
    name: 'Starting Point',
    category: 'Your morning',
    cadence: 'Weekdays · 6:00 AM',
    promise: 'Start informed, then turn the day’s biggest stories into a plan for the hours ahead.',
    accent: '#f7cb45',
    accentSoft: '#fff2bd',
    issue: 'THE MORNING EDITION · AUGUST 5',
    headline: 'The six things New England is talking about today',
    dek: 'A fast, human guide to the news—plus one good reason to put your phone down and go somewhere after work.',
    author: 'The Starting Point team',
    readTime: '4 min read',
    utilityName: 'Day planner',
    utilityDescription: 'Turn what you read into alerts, calendar holds, explainers, and things to do nearby.',
    trackerTitle: 'Your day, assembled',
    trackerItems: [
      { label: 'Morning news', detail: '6 stories · 12 minutes', status: 'Ready', progress: 100 },
      { label: 'Commute watch', detail: 'Red Line advisory', status: 'Check before 5', progress: 61 },
      { label: 'After work', detail: '4 picks near Boston', status: 'Make a plan', progress: 34 },
    ],
    events: [
      { time: '12:00 PM', title: 'Today’s newsroom conversation', place: 'Live audio' },
      { time: '5:30 PM', title: 'Free concert on City Hall Plaza', place: 'Downtown Boston' },
      { time: '7:00 PM', title: 'Member night at the MFA', place: 'Museum of Fine Arts', member: true },
    ],
    prompts: ['Give me the 90-second version', 'What can wait until tonight?', 'Find something near my commute'],
    answer:
      'If you have 90 seconds: the transit advisory affects the evening commute, the State House is quiet but housing talks continue, and air quality should improve by late afternoon. Save the deeper court explainer for tonight.',
  },
];

const IDEAS = [
  { name: 'Field Day', label: 'Families', description: 'School calendars, camps, weekend plans, and parent-tested answers.', color: '#ff9ec4' },
  { name: 'Trailhead', label: 'Outdoors', description: 'Conditions, routes, reservations, and a reason to go now.', color: '#9ee7d5' },
  { name: 'Table for New England', label: 'Food', description: 'Neighborhood dining intelligence that can book the table, too.', color: '#ffb45d' },
];

/*
 * The prototype normally receives its full CSS Module. This small inline layer
 * keeps the first screen legible in constrained preview environments that
 * intentionally block route-local stylesheet requests. It matches the same
 * visual system and has no product or data dependency.
 */
const PREVIEW_FALLBACK_STYLES = `
  main[class*="prototype"] { min-height:100vh; color:#171717; background:#fff; font-family:Georgia,"Times New Roman",serif; }
  main[class*="prototype"] *, main[class*="prototype"] *::before, main[class*="prototype"] *::after { box-sizing:border-box; }
  main[class*="prototype"] button { color:inherit; cursor:pointer; }
  [class*="topbar"] { height:78px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:22px; padding:0 clamp(20px,5vw,74px); border-bottom:1px solid #d8d8d8; background:#fff; position:sticky; top:0; z-index:20; font-family:Arial,Helvetica,sans-serif; }
  [class*="brandButton"], [class*="mobileMenu"], [class*="topActions"] button, [class*="primaryNav"] button { border:0; background:transparent; }
  [class*="brandButton"] { justify-self:start; padding:0; } [class*="globeMark"] { display:grid; line-height:.9; text-align:left; }
  [class*="globeMark"] span { font:700 18px Georgia,"Times New Roman",serif; letter-spacing:-.8px; } [class*="globeMark"] b { margin-top:4px; font:700 9px Arial,Helvetica,sans-serif; letter-spacing:2.7px; }
  [class*="primaryNav"] { display:flex; gap:25px; height:100%; align-items:center; } [class*="primaryNav"] button { height:100%; padding:2px 0 0; color:#77736c; font-size:13px; } [class*="navActive"] { color:#171717!important; font-weight:700; border-bottom:3px solid #171717!important; }
  [class*="topActions"] { justify-self:end; display:flex; align-items:center; gap:6px; } [class*="topActions"] button, [class*="mobileMenu"] { position:relative; width:37px; height:37px; display:grid; place-items:center; border-radius:50%; } [class*="notificationDot"] { position:absolute; top:8px; right:8px; width:6px; height:6px; border-radius:50%; background:#d32335; }
  [class*="prototypeFlag"] { display:flex; align-items:center; justify-content:center; gap:7px; min-height:32px; background:#171717; color:#fff; font:700 9px/1 Arial,Helvetica,sans-serif; letter-spacing:1.5px; }
  [class*="pageShell"] { width:min(1200px,calc(100% - 48px)); margin:0 auto; } [class*="homeIntro"] { padding:clamp(42px,7vw,84px) 0 38px; display:flex; justify-content:space-between; align-items:end; gap:24px; }
  [class*="kicker"] { margin:0 0 11px; color:#6f6c65; font:700 10px/1.2 Arial,Helvetica,sans-serif; letter-spacing:1.55px; } [class*="homeIntro"] h1 { font-size:clamp(42px,5.3vw,72px); line-height:.94; letter-spacing:-3.4px; margin:0 0 13px; font-weight:500; } [class*="homeIntro"] > div > p:last-child { color:#67645e; font-size:18px; line-height:1.4; max-width:540px; margin:0; }
  [class*="tuneButton"] { border:1px solid #171717; background:transparent; border-radius:999px; padding:12px 15px; display:flex; gap:8px; align-items:center; font:700 12px Arial,Helvetica,sans-serif; }
  [class*="editionRail"] { border-block:1px solid #d8d8d8; padding:25px 0 27px; } [class*="sectionHeading"] { display:flex; justify-content:space-between; align-items:end; margin-bottom:16px; } [class*="sectionHeading"] span { display:block; margin-bottom:6px; font:700 10px Arial,Helvetica,sans-serif; letter-spacing:1.5px; color:#6f6c65; } [class*="sectionHeading"] h2 { margin:0; font-size:24px; letter-spacing:-1px; font-weight:500; } [class*="sectionHeading"] > button { border:0; background:transparent; font:700 12px Arial,Helvetica,sans-serif; text-decoration:underline; }
  [class*="railScroller"] { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; } [class*="railCard"] { min-height:86px; padding:12px; display:flex; align-items:center; text-align:left; gap:10px; border:0; border-radius:5px; } [class*="railCard"] > span:nth-child(2) { display:grid; gap:4px; flex:1; min-width:0; } [class*="railCard"] b { font:700 13px Arial,Helvetica,sans-serif; } [class*="railCard"] small { color:#585650; font:11px Arial,Helvetica,sans-serif; } [class*="addEdition"] { background:transparent!important; border:1px dashed #aaa69d!important; } [class*="plus"] { display:grid; place-items:center; width:36px; height:36px; border-radius:50%; background:#efede8; font:300 26px/1 Arial,Helvetica,sans-serif; }
  [class*="monogram"] { width:39px; height:39px; flex:0 0 39px; border-radius:50%; display:grid; place-items:center; color:#171717; font:700 18px Georgia,"Times New Roman",serif; } [class*="monogramSmall"] { width:25px; height:25px; flex-basis:25px; font-size:12px; }
  [class*="homeGrid"] { display:grid; grid-template-columns:minmax(0,1fr) 312px; gap:18px; padding:42px 0; } [class*="leadStory"] { display:grid; grid-template-columns:minmax(230px,.88fr) minmax(250px,1.12fr); min-height:405px; background:#252525; color:#fff; overflow:hidden; } [class*="leadArt"] { position:relative; overflow:hidden; min-height:290px; background:var(--lead); color:#151515; } [class*="artGrid"] { position:absolute; inset:0; display:grid; grid-template-columns:repeat(3,1fr); opacity:.65; } [class*="artGrid"] span { border:1px solid rgb(0 0 0 / 14%); } [class*="artLabel"] { position:absolute; left:22px; bottom:21px; font:700 clamp(28px,4vw,50px)/.78 Arial,Helvetica,sans-serif; letter-spacing:-2.5px; } [class*="artNumber"] { position:absolute; right:13px; top:10px; font:600 45px/1 Georgia,"Times New Roman",serif; }
  [class*="leadCopy"] { align-self:center; padding:36px clamp(25px,4vw,49px); } [class*="storyEdition"] { display:flex; align-items:center; gap:7px; font:700 13px Arial,Helvetica,sans-serif; margin:0 0 22px; } [class*="leadCopy"] [class*="kicker"] { color:#ceccc6; } [class*="leadCopy"] h2 { font-size:clamp(29px,3.4vw,47px); line-height:.96; letter-spacing:-2.2px; margin:0 0 15px; font-weight:500; } [class*="leadCopy"] > p:not([class*="kicker"]):not([class*="storyEdition"]) { color:#d3d1cb; margin:0 0 22px; font-size:15px; line-height:1.38; } [class*="byline"] { display:flex; gap:10px; align-items:center; color:#bbb8b1; font:11px Arial,Helvetica,sans-serif; } [class*="storyActions"] { display:flex; gap:8px; margin-top:27px; } [class*="primaryButton"] { border:0; background:#fff; color:#171717; display:inline-flex; align-items:center; gap:8px; padding:12px 14px; border-radius:2px; font:700 12px Arial,Helvetica,sans-serif; } [class*="iconButton"] { width:42px; display:grid; place-items:center; border:1px solid #66615b!important; color:#fff; background:transparent; }
  [class*="memberCard"] { padding:25px; background:#f6d45b; display:flex; flex-direction:column; align-items:flex-start; } [class*="memberBurst"] { width:85px; height:85px; margin:6px 0 18px; border-radius:50%; display:grid; place-items:center; background:#171717; color:#f6d45b; } [class*="memberCard"] h2 { font-size:34px; line-height:.92; letter-spacing:-1.7px; margin:0 0 14px; font-weight:500; } [class*="memberCard"] > p:not([class*="kicker"]) { font-size:15px; line-height:1.35; margin:0; } [class*="memberCard"] > button { border:0; background:transparent; padding:0; margin-top:auto; font:700 12px Arial,Helvetica,sans-serif; text-decoration:underline; }
  @media (max-width:850px) { [class*="primaryNav"] { display:none; } [class*="mobileMenu"] { display:grid!important; border:0; background:transparent; } [class*="pageShell"] { width:min(100% - 32px,680px); } [class*="railScroller"] { display:flex; overflow-x:auto; } [class*="railCard"] { min-width:220px; } [class*="homeGrid"] { grid-template-columns:1fr; } }
`;

function GlobeMark() {
  return (
    <div className={styles.globeMark} aria-label="The Boston Globe">
      <i aria-hidden="true">𝔅</i>
      <span>The Boston Globe</span>
      <b>MY GLOBE</b>
    </div>
  );
}

function EditionMonogram({ hub, small = false }: { hub: Hub; small?: boolean }) {
  return (
    <span
      className={`${styles.monogram} ${small ? styles.monogramSmall : ''}`}
      style={{ backgroundColor: hub.accent }}
      aria-hidden="true"
    >
      {hub.id === 'gavel' ? <Gavel /> : hub.shortName.charAt(0)}
    </span>
  );
}

export function MyGlobePrototype() {
  const [view, setView] = useState<View>('home');
  const [activeHubId, setActiveHubId] = useState<HubId>('camberville');
  const [hubSection, setHubSection] = useState<HubSection>('briefing');
  const [saved, setSaved] = useState<Set<HubId>>(new Set(['gavel']));
  const [following, setFollowing] = useState<Set<HubId>>(new Set(['camberville', 'scrum', 'gavel']));
  const [rsvps, setRsvps] = useState<Set<string>>(new Set());
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const activeHub = useMemo(
    () => HUBS.find((hub) => hub.id === activeHubId) ?? HUBS[0],
    [activeHubId],
  );

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

  function openHub(id: HubId, section: HubSection = 'briefing') {
    setActiveHubId(id);
    setHubSection(section);
    setAskAnswer(null);
    setView('hub');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleSaved(id: HubId) {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        showToast('Removed from Saved');
      } else {
        next.add(id);
        showToast('Saved for later');
      }
      return next;
    });
  }

  function toggleFollow(id: HubId) {
    setFollowing((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        showToast('Edition removed from your Globe');
      } else {
        next.add(id);
        showToast('Edition added to your Globe');
      }
      return next;
    });
  }

  const followedHubs = HUBS.filter((hub) => following.has(hub.id));

  return (
    <main className={styles.prototype}>
      <style>{PREVIEW_FALLBACK_STYLES}</style>
      <header className={styles.topbar}>
        <button className={styles.mobileMenu} aria-label="Open navigation" onClick={() => setView('explore')}>
          <ListFilter />
        </button>
        <button className={styles.brandButton} onClick={() => setView('home')}>
          <GlobeMark />
        </button>
        <nav className={styles.primaryNav} aria-label="Primary navigation">
          <button className={view === 'home' ? styles.navActive : ''} onClick={() => setView('home')}>For you</button>
          <button className={view === 'explore' ? styles.navActive : ''} onClick={() => setView('explore')}>Editions</button>
          <button className={view === 'saved' ? styles.navActive : ''} onClick={() => setView('saved')}>Saved</button>
        </nav>
        <div className={styles.topActions}>
          <button className={styles.subscribeMini} onClick={() => setPaywallOpen(true)}>Subscribe</button>
          <button className={styles.searchButton} aria-label="Search" onClick={() => setSearchOpen(true)}><Search /></button>
          <button aria-label="Notifications" onClick={() => showToast('You’re all caught up')}><Bell /><span className={styles.notificationDot} /></button>
          <button aria-label="Personalize My Globe" onClick={() => setPrefsOpen(true)}><CircleUserRound /></button>
        </div>
      </header>

      <div className={styles.prototypeFlag}><Sparkles /> CLICKABLE PRODUCT CONCEPT</div>

      {view === 'home' && (
        <HomeView
          followedHubs={followedHubs}
          saved={saved}
          onOpen={openHub}
          onSave={toggleSaved}
          onExplore={() => setView('explore')}
          onPaywall={() => setPaywallOpen(true)}
          onPreferences={() => setPrefsOpen(true)}
        />
      )}

      {view === 'explore' && (
        <ExploreView
          following={following}
          onFollow={toggleFollow}
          onOpen={openHub}
          onPaywall={() => setPaywallOpen(true)}
        />
      )}

      {view === 'saved' && (
        <SavedView saved={saved} onOpen={openHub} onExplore={() => setView('explore')} />
      )}

      {view === 'hub' && (
        <HubView
          hub={activeHub}
          section={hubSection}
          setSection={setHubSection}
          followed={following.has(activeHub.id)}
          saved={saved.has(activeHub.id)}
          rsvps={rsvps}
          askAnswer={askAnswer}
          onBack={() => setView('home')}
          onFollow={() => toggleFollow(activeHub.id)}
          onSave={() => toggleSaved(activeHub.id)}
          onShare={() => showToast('Share link copied')}
          onAsk={(prompt) => {
            setAskAnswer(activeHub.answer);
            showToast(`Answering: ${prompt}`);
          }}
          onRsvp={(event) => {
            if (event.member) {
              setPaywallOpen(true);
              return;
            }
            setRsvps((current) => new Set(current).add(`${activeHub.id}-${event.title}`));
            showToast('Added to your plans');
          }}
          onPaywall={() => setPaywallOpen(true)}
          onOpenHub={openHub}
        />
      )}

      <nav className={styles.mobileNav} aria-label="Mobile navigation">
        <button className={view === 'home' ? styles.mobileActive : ''} onClick={() => setView('home')}><House />For you</button>
        <button className={view === 'explore' ? styles.mobileActive : ''} onClick={() => setView('explore')}><Compass />Editions</button>
        <button className={view === 'saved' ? styles.mobileActive : ''} onClick={() => setView('saved')}><Bookmark />Saved</button>
      </nav>

      {paywallOpen && <MembershipModal onClose={() => setPaywallOpen(false)} />}
      {prefsOpen && <PreferencesModal following={following} setFollowing={setFollowing} onClose={() => setPrefsOpen(false)} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onOpen={openHub} />}
      {toast && <div className={styles.toast} role="status"><Check />{toast}</div>}
    </main>
  );
}

function HomeView({
  followedHubs,
  saved,
  onOpen,
  onSave,
  onExplore,
  onPaywall,
  onPreferences,
}: {
  followedHubs: Hub[];
  saved: Set<HubId>;
  onOpen: (id: HubId, section?: HubSection) => void;
  onSave: (id: HubId) => void;
  onExplore: () => void;
  onPaywall: () => void;
  onPreferences: () => void;
}) {
  const lead = followedHubs[0] ?? HUBS[0];
  return (
    <div className={styles.pageShell}>
      <section className={styles.homeIntro}>
        <div>
          <p className={styles.kicker}>WEDNESDAY, AUGUST 5 · BOSTON 76°</p>
          <h1>Good morning, Matt.</h1>
          <p>Your favorite voices, live tools, and communities—all in one place.</p>
        </div>
        <button className={styles.tuneButton} onClick={onPreferences}><Settings2 /> Tune your Globe</button>
      </section>

      <section className={styles.editionRail} aria-label="Your editions">
        <div className={styles.sectionHeading}>
          <div><span>YOUR EDITIONS</span><h2>Pick up where you left off</h2></div>
          <button onClick={onExplore}>See all <ArrowRight /></button>
        </div>
        <div className={styles.railScroller}>
          {followedHubs.map((hub) => (
            <button key={hub.id} className={styles.railCard} onClick={() => onOpen(hub.id)} style={{ background: hub.accentSoft }}>
              <EditionMonogram hub={hub} />
              <span><b>{hub.shortName}</b><small>{hub.cadence}</small></span>
              <ChevronRight />
            </button>
          ))}
          <button className={`${styles.railCard} ${styles.addEdition}`} onClick={onExplore}><span className={styles.plus}>+</span><span><b>Add an edition</b><small>Make it yours</small></span></button>
        </div>
      </section>

      <section className={styles.homeGrid}>
        <article className={styles.leadStory} style={{ '--lead': lead.accent } as React.CSSProperties}>
          <div className={styles.leadArt}>
            <div className={styles.artGrid}><span /><span /><span /><span /><span /><span /></div>
            <div className={styles.artLabel}>UNDER<br />YOUR<br />FEET</div>
            <span className={styles.artNumber}>105′</span>
          </div>
          <div className={styles.leadCopy}>
            <p className={styles.storyEdition}><EditionMonogram hub={lead} small /> {lead.name}</p>
            <p className={styles.kicker}>{lead.issue}</p>
            <h2>{lead.headline}</h2>
            <p>{lead.dek}</p>
            <div className={styles.byline}><b>{lead.author}</b><span>{lead.readTime}</span></div>
            <div className={styles.storyActions}>
              <button className={styles.primaryButton} onClick={() => onOpen(lead.id)}>Open today’s edition <ArrowRight /></button>
              <button className={styles.iconButton} aria-label="Save story" onClick={() => onSave(lead.id)}>{saved.has(lead.id) ? <Bookmark fill="currentColor" /> : <Bookmark />}</button>
            </div>
          </div>
        </article>

        <aside className={styles.memberCard}>
          <p className={styles.kicker}>MEMBER ACCESS</p>
          <div className={styles.memberBurst}><Star /><span>BE<br />THERE</span></div>
          <h2>Go beyond the read.</h2>
          <p>Join newsroom briefings, save trackers, RSVP first, and ask the journalists who know your world.</p>
          <button onClick={onPaywall}>See what membership unlocks <ArrowRight /></button>
        </aside>
      </section>

      <section className={styles.utilityStrip}>
        <div className={styles.sectionHeading}>
          <div><span>USEFUL NOW</span><h2>Today, not someday</h2></div>
        </div>
        <div className={styles.utilityCards}>
          <button onClick={() => onOpen('camberville', 'tracker')}><Map /><span><small>CAMBERVILLE</small><b>3 projects changed status</b><em>Open development watch</em></span><ChevronRight /></button>
          <button onClick={() => onOpen('scrum', 'tracker')}><Zap /><span><small>THE SCRUM</small><b>Housing bill moved overnight</b><em>See the pressure map</em></span><ChevronRight /></button>
          <button onClick={() => onOpen('gavel', 'community')}><MessageCircle /><span><small>THE GAVEL</small><b>Kimberly answers readers at 7</b><em>Submit your question</em></span><ChevronRight /></button>
        </div>
      </section>
    </div>
  );
}

function ExploreView({
  following,
  onFollow,
  onOpen,
  onPaywall,
}: {
  following: Set<HubId>;
  onFollow: (id: HubId) => void;
  onOpen: (id: HubId) => void;
  onPaywall: () => void;
}) {
  return (
    <div className={styles.pageShell}>
      <section className={styles.exploreHero}>
        <p className={styles.kicker}>EXPLORE EDITIONS</p>
        <h1>Follow a world,<br />not a feed.</h1>
        <p>Each edition combines a trusted voice with tools, access, and people who care about the same things.</p>
      </section>
      <section className={styles.exploreGrid}>
        {HUBS.map((hub, index) => (
          <article key={hub.id} className={styles.exploreCard} style={{ background: hub.accentSoft }}>
            <div className={styles.exploreTop}><span>0{index + 1}</span><EditionMonogram hub={hub} /></div>
            <p className={styles.kicker}>{hub.category}</p>
            <h2>{hub.name}</h2>
            <p>{hub.promise}</p>
            <div className={styles.exploreMeta}><span>{hub.cadence}</span><span>By {hub.author}</span></div>
            <div className={styles.exploreActions}>
              <button className={styles.primaryButton} onClick={() => onOpen(hub.id)}>Open edition</button>
              <button className={styles.followButton} onClick={() => onFollow(hub.id)}>{following.has(hub.id) ? <><Check /> Following</> : <>+ Follow</>}</button>
            </div>
          </article>
        ))}
      </section>
      <section className={styles.conceptLab}>
        <div><p className={styles.kicker}>CONCEPT LAB</p><h2>What could come next</h2><p>The same product model can turn life-stage and interest journalism into recurring utility.</p></div>
        <div className={styles.ideaGrid}>
          {IDEAS.map((idea) => (
            <button key={idea.name} style={{ background: idea.color }} onClick={onPaywall}>
              <small>{idea.label} · early concept</small><b>{idea.name}</b><span>{idea.description}</span><em>Preview the idea <ArrowRight /></em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SavedView({ saved, onOpen, onExplore }: { saved: Set<HubId>; onOpen: (id: HubId) => void; onExplore: () => void }) {
  const items = HUBS.filter((hub) => saved.has(hub.id));
  return (
    <div className={styles.pageShell}>
      <section className={styles.savedHeader}><p className={styles.kicker}>YOUR LIBRARY</p><h1>Saved for later.</h1><p>Stories, trackers, and plans stay together—not buried in an inbox.</p></section>
      {items.length ? (
        <div className={styles.savedList}>
          {items.map((hub) => <button key={hub.id} onClick={() => onOpen(hub.id)}><EditionMonogram hub={hub} /><span><small>{hub.name}</small><b>{hub.headline}</b><em>{hub.author} · {hub.readTime}</em></span><ArrowRight /></button>)}
        </div>
      ) : (
        <div className={styles.emptyState}><Bookmark /><h2>Nothing saved yet</h2><p>Save a story or utility and it will wait here.</p><button className={styles.primaryButton} onClick={onExplore}>Explore editions</button></div>
      )}
    </div>
  );
}

function HubView({
  hub,
  section,
  setSection,
  followed,
  saved,
  rsvps,
  askAnswer,
  onBack,
  onFollow,
  onSave,
  onShare,
  onAsk,
  onRsvp,
  onPaywall,
  onOpenHub,
}: {
  hub: Hub;
  section: HubSection;
  setSection: (section: HubSection) => void;
  followed: boolean;
  saved: boolean;
  rsvps: Set<string>;
  askAnswer: string | null;
  onBack: () => void;
  onFollow: () => void;
  onSave: () => void;
  onShare: () => void;
  onAsk: (prompt: string) => void;
  onRsvp: (event: Hub['events'][number]) => void;
  onPaywall: () => void;
  onOpenHub: (id: HubId) => void;
}) {
  return (
    <div className={styles.hubPage} style={{ '--hub': hub.accent, '--hub-soft': hub.accentSoft } as React.CSSProperties}>
      <section className={styles.hubMasthead}>
        <button className={styles.backButton} onClick={onBack}><ArrowLeft /> My Globe</button>
        <div className={styles.hubIdentity}>
          <EditionMonogram hub={hub} />
          <div><p>{hub.category}</p><h1>{hub.name}</h1><span>{hub.cadence}</span></div>
        </div>
        <p className={styles.hubPromise}>{hub.promise}</p>
        <div className={styles.hubActions}><button onClick={onFollow}>{followed ? <><Check /> Following</> : <>+ Add to My Globe</>}</button><button aria-label="Share edition" onClick={onShare}><Share2 /></button></div>
      </section>
      <nav className={styles.hubTabs} aria-label={`${hub.name} sections`}>
        <button className={section === 'briefing' ? styles.hubTabActive : ''} onClick={() => setSection('briefing')}><Newspaper /> Today’s edition</button>
        <button className={section === 'tracker' ? styles.hubTabActive : ''} onClick={() => setSection('tracker')}><ListFilter /> {hub.utilityName}</button>
        <button className={section === 'community' ? styles.hubTabActive : ''} onClick={() => setSection('community')}><Users /> Community</button>
      </nav>

      {section === 'briefing' && (
        <div className={styles.hubContent}>
          <article className={styles.editionStory}>
            <p className={styles.kicker}>{hub.issue}</p>
            <h2>{hub.headline}</h2>
            <p className={styles.editionDek}>{hub.dek}</p>
            <div className={styles.byline}><b>{hub.author}</b><span>{hub.readTime}</span></div>
            <div className={styles.editorialRule}><span /><b>01</b></div>
            <p className={styles.dropcap}>Newsletters work because a person you trust shows up with a point of view. This edition keeps that intimacy, then adds the context and tools a reader needs to act on it.</p>
            <p>The day’s essential thread lives here as a durable briefing. Follow the reporting, open the source material, save what matters, and return when the story moves.</p>
            <div className={styles.inlineCallout}><Sparkles /><div><b>The web advantage</b><p>This story stays current. Changes appear here without making you hunt for a correction, update, or follow-up email.</p></div></div>
            <div className={styles.storyFooter}><button onClick={onSave}>{saved ? <Bookmark fill="currentColor" /> : <Bookmark />}{saved ? 'Saved' : 'Save for later'}</button><button onClick={onShare}><Share2 /> Share</button></div>
          </article>
          <aside className={styles.editionAside}>
            <div className={styles.utilityPreview}><div className={styles.utilityIcon}><Map /></div><p className={styles.kicker}>LIVE UTILITY</p><h3>{hub.utilityName}</h3><p>{hub.utilityDescription}</p><button onClick={() => setSection('tracker')}>Open the tracker <ArrowRight /></button></div>
            <div className={styles.insiderCard}><LockKeyhole /><p className={styles.kicker}>GLOBE MEMBER</p><h3>Come inside the story.</h3><p>Join {hub.author} for a 20-minute subscriber briefing and live Q&A.</p><button onClick={onPaywall}>Reserve your seat</button></div>
          </aside>
        </div>
      )}

      {section === 'tracker' && (
        <div className={styles.trackerLayout}>
          <section className={styles.trackerMain}>
            <p className={styles.kicker}>UPDATED TODAY AT 8:40 AM</p><h2>{hub.trackerTitle}</h2><p>{hub.utilityDescription}</p>
            <div className={styles.trackerList}>
              {hub.trackerItems.map((item, index) => (
                <button key={item.label} onClick={() => index === 1 ? onPaywall() : undefined}>
                  <span className={styles.trackerIndex}>0{index + 1}</span>
                  <span className={styles.trackerInfo}><b>{item.label}</b><small>{item.detail}</small><span className={styles.progress}><i style={{ width: `${item.progress}%` }} /></span></span>
                  <em>{index === 1 && <LockKeyhole />}{item.status}</em><ChevronRight />
                </button>
              ))}
            </div>
            <div className={styles.alertBuilder}><Bell /><div><b>Tell me when something changes</b><p>Pick a project, bill, or case. We’ll alert you only when it actually moves.</p></div><button onClick={onPaywall}>Create alert</button></div>
          </section>
          <aside className={styles.tonightCard}>
            <p className={styles.kicker}>ON THE CALENDAR</p><h3>Worth your time</h3>
            {hub.events.map((event) => {
              const key = `${hub.id}-${event.title}`;
              return <div key={event.title} className={styles.eventItem}><time>{event.time}</time><span><b>{event.title}</b><small>{event.place}</small></span><button aria-label={`Add ${event.title}`} onClick={() => onRsvp(event)}>{rsvps.has(key) ? <Check /> : event.member ? <LockKeyhole /> : '+'}</button></div>;
            })}
          </aside>
        </div>
      )}

      {section === 'community' && (
        <div className={styles.communityLayout}>
          <section className={styles.askCard}>
            <div className={styles.askHeader}><MessageCircle /><div><p className={styles.kicker}>ASK {hub.author.split(' ')[0].toUpperCase()}</p><h2>What do you want to understand?</h2></div></div>
            <p>Ask against this edition and its reporting. Get a sourced answer, not another search result.</p>
            <div className={styles.promptChips}>{hub.prompts.map((prompt) => <button key={prompt} onClick={() => onAsk(prompt)}>{prompt}<ArrowRight /></button>)}</div>
            {askAnswer && <div className={styles.answer}><Sparkles /><div><b>From this edition</b><p>{askAnswer}</p><span>Based on Globe reporting · Reviewed by the edition team</span></div></div>}
          </section>
          <aside className={styles.readerRoom}>
            <p className={styles.kicker}>READER ROOM</p><h3>The conversation is part of the product.</h3>
            <div className={styles.readerQuote}><div className={styles.avatar}>JR</div><p>“What’s the one meeting this month where public comment could still change the outcome?”</p><span>Jamie R. · Cambridge</span></div>
            <div className={styles.readerQuote}><div className={styles.avatar}>AM</div><p>“I’d love a five-minute audio version for my commute.”</p><span>Alex M. · Boston</span></div>
            <button onClick={onPaywall}>Join the reader room <Users /></button>
          </aside>
        </div>
      )}

      <section className={styles.moreEditions}>
        <p className={styles.kicker}>KEEP EXPLORING</p><h2>More from My Globe</h2>
        <div>{HUBS.filter((item) => item.id !== hub.id).slice(0, 3).map((item) => <button key={item.id} style={{ background: item.accentSoft }} onClick={() => onOpenHub(item.id)}><EditionMonogram hub={item} /><span><b>{item.name}</b><small>{item.category}</small></span><ArrowRight /></button>)}</div>
      </section>
    </div>
  );
}

function MembershipModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.membershipModal} role="dialog" aria-modal="true" aria-labelledby="membership-title">
        <button className={styles.modalClose} aria-label="Close" onClick={onClose}><X /></button>
        <div className={styles.modalColor}><span>READ</span><span>DO</span><span>JOIN</span></div>
        <div className={styles.modalCopy}>
          <p className={styles.kicker}>GLOBE MEMBERSHIP</p><h2 id="membership-title">The story is only<br />the starting point.</h2>
          <p>Get the journalism you trust, plus the tools and access that help you do something with it.</p>
          <ul><li><Check /> Live trackers and useful alerts</li><li><Check /> Subscriber briefings and events</li><li><Check /> Journalist Q&As and reader rooms</li><li><Check /> One personalized New England home</li></ul>
          <div className={styles.price}><b>$1</b><span>per week<br />for 6 months</span></div>
          <button className={styles.subscribeButton} onClick={onClose}>Start my membership <ArrowRight /></button>
          <small>Prototype only — no purchase will be made.</small>
        </div>
      </section>
    </div>
  );
}

function PreferencesModal({ following, setFollowing, onClose }: { following: Set<HubId>; setFollowing: React.Dispatch<React.SetStateAction<Set<HubId>>>; onClose: () => void }) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.preferencesModal} role="dialog" aria-modal="true" aria-labelledby="preferences-title">
        <button className={styles.modalClose} aria-label="Close" onClick={onClose}><X /></button>
        <p className={styles.kicker}>PERSONALIZE</p><h2 id="preferences-title">Tune your Globe.</h2><p>Choose the worlds you want to follow. You can change this anytime.</p>
        <div className={styles.preferenceList}>{HUBS.map((hub) => {
          const selected = following.has(hub.id);
          return <button key={hub.id} onClick={() => setFollowing((current) => { const next = new Set(current); if (selected) next.delete(hub.id); else next.add(hub.id); return next; })}><EditionMonogram hub={hub} small /><span><b>{hub.name}</b><small>{hub.category}</small></span><i className={selected ? styles.toggleOn : ''}><span /></i></button>;
        })}</div>
        <button className={styles.savePreferences} onClick={onClose}>Save my Globe</button>
      </section>
    </div>
  );
}

function SearchModal({ onClose, onOpen }: { onClose: () => void; onOpen: (id: HubId) => void }) {
  const [query, setQuery] = useState('');
  const matches = HUBS.filter((hub) => `${hub.name} ${hub.category} ${hub.headline}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={styles.searchBackdrop}>
      <section className={styles.searchModal} role="dialog" aria-modal="true" aria-label="Search My Globe">
        <div className={styles.searchInput}><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search editions, topics, places…" /><button aria-label="Close search" onClick={onClose}><X /></button></div>
        <p className={styles.kicker}>{query ? `${matches.length} RESULTS` : 'TRY AN EDITION'}</p>
        <div className={styles.searchResults}>{matches.map((hub) => <button key={hub.id} onClick={() => { onClose(); onOpen(hub.id); }}><EditionMonogram hub={hub} small /><span><b>{hub.name}</b><small>{hub.category}</small></span><ArrowRight /></button>)}</div>
      </section>
    </div>
  );
}
