import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Check,
  Database,
  ExternalLink,
  FileText,
  Layers3,
  MousePointer2,
  Presentation,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { DumpsterMark } from '@/components/shell/logo';
import { PlatformIcon } from '@/components/ui/platform-icon';
import type { Platform } from '@/lib/types';
import styles from './internal.module.css';

export const metadata: Metadata = {
  title: 'Data Dumpster at Boston Globe Media',
  description:
    'Meet the home-grown social intelligence platform built around Boston Globe Media teams, workflows and data.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about/internal' },
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Data Dumpster — Built here. Built for the newsroom.',
    description:
      'A Globe-built view of the social landscape, with our history, our context and the evidence behind every result.',
    type: 'website',
    url: 'https://pressbox-kappa.vercel.app/about/internal',
    images: [
      {
        url: 'https://pressbox-kappa.vercel.app/product/data-dumpster-internal-social.png',
        width: 1200,
        height: 630,
        alt: 'Data Dumpster, built at Boston Globe Media for the newsroom',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Data Dumpster — Built here. Built for the newsroom.',
    description: 'Our data. Our context. One clear view of the social landscape.',
    images: ['https://pressbox-kappa.vercel.app/product/data-dumpster-internal-social.png'],
  },
};

const platforms = [
  'facebook',
  'instagram',
  'linkedin',
  'threads',
  'twitter',
  'youtube',
  'tiktok',
  'bluesky',
  'reddit',
] as const satisfies readonly Platform[];

const engagementLeaders = [
  { name: 'B-Side', value: '62,693', percent: 100, color: '#c8102e' },
  { name: 'The Boston Globe', value: '47,798', percent: 76, color: '#e7294f' },
  { name: 'Boston.com', value: '29,013', percent: 46, color: '#ff718a' },
  { name: 'Boston Magazine', value: '15,902', percent: 25, color: '#252529' },
] as const;

const audienceMix = [
  { platform: 'facebook', label: 'Facebook', value: '573k', width: 28 },
  { platform: 'instagram', label: 'Instagram', value: '469k', width: 23 },
  { platform: 'linkedin', label: 'LinkedIn', value: '73k', width: 6 },
  { platform: 'youtube', label: 'YouTube', value: '135k', width: 9 },
  { platform: 'twitter', label: 'X', value: '771k', width: 34 },
] as const satisfies readonly {
  platform: Platform;
  label: string;
  value: string;
  width: number;
}[];

const useCases = [
  {
    icon: BarChart3,
    label: 'Start the day',
    title: 'See who is moving the market.',
    body: 'Open one landscape and immediately see the brands, channels and posts generating attention now.',
  },
  {
    icon: MousePointer2,
    label: 'Follow the evidence',
    title: 'Go from the spike to the post.',
    body: 'Open the creative, copy, source link and captured performance without losing the comparison around it.',
  },
  {
    icon: Presentation,
    label: 'Bring it to the room',
    title: 'Share the same measured view.',
    body: 'Turn the week into an executive report or put the last 24 hours on a newsroom screen.',
  },
] as const;

function PlatformRail() {
  return (
    <div className={styles.platformRail} aria-label="Supported social platforms">
      <span>ONE VIEW ACROSS</span>
      {platforms.map((platform) => (
        <span className={styles.platformItem} key={platform}>
          <PlatformIcon platform={platform} label className="h-5 w-5" />
        </span>
      ))}
      <strong>9 platforms</strong>
    </div>
  );
}

function SignalChart() {
  return (
    <div className={styles.signalChart} aria-label="Sample seven-day engagement trend">
      <div className={styles.chartHeading}>
        <div>
          <span>LANDSCAPE ENGAGEMENT</span>
          <strong>412,086</strong>
        </div>
        <em>7 DAYS</em>
      </div>
      <svg viewBox="0 0 700 230" role="img" aria-label="Engagement rises across a seven-day window">
        <defs>
          <linearGradient id="signal-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f13857" stopOpacity=".42" />
            <stop offset="1" stopColor="#f13857" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className={styles.gridLine} d="M0 44H700M0 112H700M0 180H700" />
        <path
          className={styles.areaPath}
          d="M0 182 C55 178 62 134 112 143 C165 154 174 100 230 112 C278 123 305 66 354 82 C409 100 420 38 476 58 C528 77 550 35 593 47 C642 60 665 20 700 25 L700 230 L0 230Z"
        />
        <path
          className={styles.linePath}
          d="M0 182 C55 178 62 134 112 143 C165 154 174 100 230 112 C278 123 305 66 354 82 C409 100 420 38 476 58 C528 77 550 35 593 47 C642 60 665 20 700 25"
        />
        <circle cx="700" cy="25" r="7" className={styles.chartDot} />
      </svg>
      <div className={styles.chartAxis} aria-hidden="true">
        <span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span>
      </div>
    </div>
  );
}

function LeaderChart() {
  return (
    <div className={styles.leaderChart}>
      <div className={styles.panelHeading}>
        <div><span>OWNED BRAND PULSE</span><h3>Who generated engagement</h3></div>
        <em>SAMPLE WEEK</em>
      </div>
      <div className={styles.leaderList}>
        {engagementLeaders.map((leader, index) => (
          <div className={styles.leaderRow} key={leader.name}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{leader.name}</strong>
            <i><b style={{ '--bar-width': `${leader.percent}%`, '--bar-color': leader.color } as CSSProperties} /></i>
            <em>{leader.value}</em>
          </div>
        ))}
      </div>
      <p><ShieldCheck size={15} /> Computed from the selected window. Click through to the posts behind the result.</p>
    </div>
  );
}

function AudienceCard() {
  return (
    <div className={styles.audienceCard}>
      <div className={styles.panelHeading}>
        <div><span>AUDIENCE SNAPSHOT</span><h3>The Boston Globe</h3></div>
        <em>2,499,694</em>
      </div>
      <div className={styles.stackedBar} aria-label="Audience mix by platform">
        {audienceMix.map((item) => (
          <span
            key={item.platform}
            className={styles[`platform_${item.platform}`]}
            style={{ width: `${item.width}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      <div className={styles.audienceLegend}>
        {audienceMix.map((item) => (
          <div key={item.platform}>
            <PlatformIcon platform={item.platform} className="h-4 w-4" />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InternalPromoPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span>INTERNAL</span> A Boston Globe Media product</p>
          <h1>Built here.<br /><em>Built for the newsroom.</em></h1>
          <p className={styles.heroSummary}>
            Data Dumpster gives Globe teams one fast, visual way to understand the social
            landscape—using a tool we shaped, a history we retain and evidence anyone can inspect.
          </p>
          <div className={styles.heroActions}>
            <Link href="/login" className={styles.primaryAction}>
              Open Data Dumpster <ArrowRight size={17} />
            </Link>
            <Link href="/about/training" className={styles.secondaryAction}>
              Training and quick start
            </Link>
          </div>
          <div className={styles.heroProof}>
            <span><Check size={15} /> Home-grown at BGM</span>
            <span><Check size={15} /> Our historical record</span>
            <span><Check size={15} /> Designed for everyday use</span>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.visualLabel}><span>LIVE PRODUCT VIEW</span><em>Social post intelligence</em></div>
          <Image
            src="/product/data-dumpster-laptop.png"
            alt="Data Dumpster showing a detailed social post performance view"
            width={2800}
            height={1845}
            priority
            sizes="(max-width: 980px) 96vw, 54vw"
            className={styles.heroImage}
          />
        </div>
        <PlatformRail />
      </section>

      <section className={styles.ownershipSection}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>What makes it different</p>
          <h2>Our data compounds.<br /><span>Our context stays attached.</span></h2>
          <p>
            Data Dumpster is not another rented dashboard with our work trapped inside it. The
            normalized public record is retained in our backend, reused across landscapes and
            available for the next question—not collected again from scratch.
          </p>
        </div>
        <div className={styles.ownershipGrid}>
          <article>
            <div><Users size={22} /><span>01</span></div>
            <h3>Home-grown</h3>
            <p>Built around the way Globe teams compare brands, investigate stories and brief leadership.</p>
          </article>
          <article>
            <div><Database size={22} /><span>02</span></div>
            <h3>Retained and reusable</h3>
            <p>A shared profile is collected once, stored once and reused wherever it belongs.</p>
          </article>
          <article>
            <div><MousePointer2 size={22} /><span>03</span></div>
            <h3>Easy to interrogate</h3>
            <p>Pick a market and date range, then move from the chart to the evidence in a click.</p>
          </article>
        </div>
        <div className={styles.dataFlow} aria-label="How Data Dumpster reuses public social data">
          <div><Layers3 size={20} /><span>PUBLIC SOCIAL SOURCES</span><strong>Profiles + posts</strong></div>
          <i><ArrowRight size={18} /></i>
          <div className={styles.dataFlowCore}><DumpsterMark className="h-6 w-6" /><span>SHARED BGM RECORD</span><strong>Stored once</strong></div>
          <i><ArrowRight size={18} /></i>
          <div><Sparkles size={20} /><span>EVERY LANDSCAPE</span><strong>Reused instantly</strong></div>
        </div>
      </section>

      <section className={styles.dashboardSection}>
        <div className={styles.dashboardHeader}>
          <div>
            <p className={styles.eyebrow}>A useful answer, fast</p>
            <h2>See the week.<br /><span>Then see why.</span></h2>
          </div>
          <p>
            Scan the movement, compare the players and open the work behind the number. The
            dashboard stays visual without flattening the story into a single score.
          </p>
        </div>
        <div className={styles.dashboardCanvas}>
          <div className={styles.dashboardChrome}>
            <div><DumpsterMark className="h-4 w-4" /><strong>Boston News Landscape</strong></div>
            <span>22 COMPANIES</span>
            <span>9 PLATFORMS</span>
            <em>AUG 3–9</em>
          </div>
          <div className={styles.dashboardGrid}>
            <SignalChart />
            <LeaderChart />
            <AudienceCard />
            <div className={styles.metricStrip}>
              <div><span>NET FOLLOWERS</span><strong>+3,291</strong><small>selected week</small></div>
              <div><span>ENGAGEMENT</span><strong>47,798</strong><small>captured total</small></div>
              <div><span>ENGAGEMENT / POST</span><strong>155.2</strong><small>308 posts</small></div>
            </div>
          </div>
          <p className={styles.sampleNote}>Illustrative product composition using a recent measured report. Figures remain tied to their selected window and source coverage.</p>
        </div>
      </section>

      <section className={styles.useSection}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>One product, three newsroom moments</p>
          <h2>Useful before the stand-up.<br /><span>And before the big meeting.</span></h2>
        </div>
        <div className={styles.useGrid}>
          {useCases.map(({ icon: Icon, label, title, body }, index) => (
            <article key={title}>
              <div className={styles.useCardTop}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <Icon size={23} />
              </div>
              <p>{label}</p>
              <h3>{title}</h3>
              <span>{body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.screenSection}>
        <div className={styles.screenCopy}>
          <p className={styles.eyebrow}>The work stays connected</p>
          <h2>From screen<br /><span>to share-out.</span></h2>
          <p>
            The same stored record powers day-to-day analysis, the newsroom display and the
            weekly executive report. No rebuilding the story in a spreadsheet before every meeting.
          </p>
          <ul>
            <li><Check size={17} /> Clickable post cards with media and source links</li>
            <li><Check size={17} /> Public report links for easy distribution</li>
            <li><Check size={17} /> PowerPoint, CSV and Markdown exports</li>
            <li><Check size={17} /> Clear source and coverage labels</li>
          </ul>
        </div>
        <div className={styles.screenStack}>
          <div className={styles.screenCard}>
            <div><span>TOP CONTENT</span><em>CLICK TO INSPECT</em></div>
            <Image
              src="/product/data-dumpster-laptop.png"
              alt="Data Dumpster post detail view"
              width={2800}
              height={1845}
              sizes="(max-width: 900px) 92vw, 58vw"
            />
          </div>
          <div className={styles.reportMiniCard}>
            <div><FileText size={20} /><span>WEEKLY INTELLIGENCE</span><em>READY TO SHARE</em></div>
            <h3>Platforms Dashboard and Digest</h3>
            <p>Audience movement · engagement · top posts · competitive rank</p>
            <div className={styles.miniChart}><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
        </div>
      </section>

      <section className={styles.closingSection}>
        <div className={styles.closingMark}><DumpsterMark className="h-10 w-10" /></div>
        <p className={styles.eyebrow}>Built at Boston Globe Media</p>
        <h2>Our landscape.<br /><span>Our history. Our tool.</span></h2>
        <p>
          Start with the four-minute workflow, explore a landscape and bring the evidence into
          the next newsroom conversation.
        </p>
        <div className={styles.heroActions}>
          <Link href="/login" className={styles.primaryAction}>Open Data Dumpster <ExternalLink size={16} /></Link>
          <Link href="/about/training" className={styles.secondaryAction}>Go to the training center</Link>
        </div>
      </section>
    </main>
  );
}
