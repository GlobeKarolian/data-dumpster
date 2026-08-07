import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Bell,
  FileText,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { DumpsterMark } from '@/components/shell/logo';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'Data Dumpster — Competitive intelligence for newsrooms',
  description:
    'See what is breaking through across the social landscape, understand why, and turn it into a newsroom decision.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Data Dumpster — Competitive intelligence for newsrooms',
    description:
      'One competitive view across the social platforms that shape the news cycle.',
    type: 'website',
    url: 'https://pressbox-kappa.vercel.app/about',
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

const leaders = [
  { name: 'The Harbor Journal', value: '48.2k', width: '92%' },
  { name: 'Metro Newsroom', value: '31.7k', width: '66%' },
  { name: 'City Desk', value: '18.9k', width: '43%' },
  { name: 'Public Radio', value: '12.4k', width: '30%' },
] as const;

const featureCards = [
  {
    icon: Layers,
    kicker: 'Landscapes',
    title: 'Your market, defined your way.',
    body: 'Group owned brands and competitors once. Public observations are pooled, so the same profile is collected once and reused everywhere it belongs.',
  },
  {
    icon: Search,
    kicker: 'Content intelligence',
    title: 'Go from the number to the post.',
    body: 'Open the media, copy, link, topic and engagement behind a result. Find the pattern without losing the evidence.',
  },
  {
    icon: FileText,
    kicker: 'Weekly reports',
    title: 'A leadership readout, ready to move.',
    body: 'Combine computed performance with newsroom context, then export the same trusted snapshot to PowerPoint, CSV or Markdown.',
  },
  {
    icon: Bell,
    kicker: 'Alerts',
    title: 'Know when the landscape changes.',
    body: 'Watch for breakout posts and material shifts without living in another dashboard all day.',
  },
] as const;

function ProductScreen() {
  return (
    <div className={styles.productScreen} aria-label="Illustration of the Data Dumpster cross-channel workspace">
      <div className={styles.screenTopbar}>
        <div className={styles.screenBrand}>
          <span className={styles.screenMark}><DumpsterMark className="h-4 w-4" /></span>
          <span>Data Dumpster</span>
        </div>
        <div className={styles.windowDots} aria-hidden="true"><i /><i /><i /></div>
      </div>
      <div className={styles.screenBody}>
        <aside className={styles.mockSidebar}>
          <div className={styles.landscapePill}>
            <strong>Boston News</strong>
            <span>22 companies</span>
          </div>
          <div className={styles.mockNav}>
            <span className={styles.mockNavActive}><BarChart3 size={15} /> Cross-Channel</span>
            {platforms.slice(0, 6).map((platform) => (
              <span key={platform}>
                <PlatformIcon
                  platform={platform}
                  className={
                    platform === 'twitter' || platform === 'threads'
                      ? 'h-3.5 w-3.5 !text-zinc-50'
                      : 'h-3.5 w-3.5'
                  }
                />
                {PLATFORM_LABELS[platform]}
              </span>
            ))}
          </div>
        </aside>
        <div className={styles.mockCanvas}>
          <div className={styles.canvasHeader}>
            <div>
              <span>Cross-Channel</span>
              <small>Boston News Landscape</small>
            </div>
            <span className={styles.livePill}>Automatic · 2× daily</span>
          </div>
          <div className={styles.statGrid}>
            <div><span>Audience</span><strong>8.7M</strong><i className={styles.sparkOne} /></div>
            <div><span>Posts</span><strong>1,284</strong><i className={styles.sparkTwo} /></div>
            <div><span>Engagement</span><strong>412k</strong><i className={styles.sparkThree} /></div>
          </div>
          <div className={styles.topContentHeader}>
            <div><small>TOP CONTENT</small><strong>What is breaking through</strong></div>
            <span>Last 7 days</span>
          </div>
          <div className={styles.postGrid}>
            <article className={styles.postCard}>
              <div className={`${styles.postArt} ${styles.postArtRed}`}><span>1</span></div>
              <div><strong>The Harbor Journal</strong><span>Instagram · 18.4k engagement</span></div>
            </article>
            <article className={styles.postCard}>
              <div className={`${styles.postArt} ${styles.postArtBlue}`}><span>2</span></div>
              <div><strong>Metro Newsroom</strong><span>Facebook · 12.7k engagement</span></div>
            </article>
            <article className={styles.postCard}>
              <div className={`${styles.postArt} ${styles.postArtGold}`}><span>3</span></div>
              <div><strong>City Desk</strong><span>TikTok · 9.8k engagement</span></div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewsroomScreen() {
  return (
    <div className={styles.newsroomScreen} aria-label="Illustration of the Data Dumpster Newsroom Screen">
      <div className={styles.newsroomChrome}>
        <div><span className={styles.newsroomDot} /> Boston News Landscape</div>
        <span>NEWSROOM LIVE</span>
        <small>Rolling 24 hours</small>
      </div>
      <div className={styles.newsroomCopy}>
        <p>WHO IS GENERATING THE MOST ENGAGEMENT</p>
        <h3>The news cycle,<br />at newsroom scale.</h3>
      </div>
      <div className={styles.leaderRows}>
        {leaders.map((leader, index) => (
          <div key={leader.name} className={styles.leaderRow}>
            <span>#{index + 1}</span>
            <strong>{leader.name}</strong>
            <i><b style={{ width: leader.width }} /></i>
            <em>{leader.value}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AboutPage() {
  return (
    <main className={styles.promo}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Competitive intelligence for newsrooms</p>
          <h1>Know what&apos;s breaking through.<br /><span>Before the meeting.</span></h1>
          <p className={styles.heroSummary}>
            Data Dumpster turns the public social landscape into a clear newsroom signal—who is
            winning, what is working, and what deserves your attention next.
          </p>
          <div className={styles.heroActions}>
            <Link href="/login" className={styles.primaryAction}>
              Sign in <ArrowRight size={17} />
            </Link>
            <a href="#see-the-signal" className={styles.secondaryAction}>See how it works</a>
          </div>
        </div>
        <div className={styles.heroProduct}>
          <ProductScreen />
        </div>
      </section>

      <section className={styles.platformSection} id="see-the-signal">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>One competitive view</p>
          <h2>Every signal.<br /><span>One landscape.</span></h2>
          <p>
            Compare the platforms that shape the news cycle without stitching together nine tabs,
            nine exports and nine definitions of engagement.
          </p>
        </div>
        <div className={styles.platformRail} aria-label="Supported social platforms">
          {platforms.map((platform) => (
            <div key={platform} className={styles.platformChip}>
              <PlatformIcon
                platform={platform}
                label
                className={
                  platform === 'twitter' || platform === 'threads'
                    ? 'h-6 w-6 !text-zinc-950'
                    : 'h-6 w-6'
                }
              />
              <span>{PLATFORM_LABELS[platform]}</span>
            </div>
          ))}
        </div>
        <div className={styles.signalGrid}>
          <article className={`${styles.signalCard} ${styles.signalCardWide}`}>
            <div className={styles.cardLabel}><TrendingUp size={17} /> Competitive context</div>
            <h3>See the field, not just yourself.</h3>
            <p>Rank brands inside the exact market, platform mix and time window that matter.</p>
            <div className={styles.miniLeaderboard} aria-hidden="true">
              {leaders.slice(0, 3).map((leader, index) => (
                <div key={leader.name}>
                  <span>{index + 1}</span><strong>{leader.name}</strong><i><b style={{ width: leader.width }} /></i><em>{leader.value}</em>
                </div>
              ))}
            </div>
          </article>
          <article className={`${styles.signalCard} ${styles.signalCardRed}`}>
            <div className={styles.cardLabel}><Sparkles size={17} /> Top content</div>
            <h3>The post behind the number.</h3>
            <p>Media, copy, platform and performance stay together, so a winner becomes a usable hypothesis.</p>
            <div className={styles.storyTile} aria-hidden="true">
              <div /><span>BREAKOUT POST</span><strong>18.4×</strong><small>account median</small>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.darkChapter}>
        <div className={styles.darkIntro}>
          <p className={styles.eyebrow}>Built for the room</p>
          <h2>Put the live competitive picture<br /><span>where the newsroom can see it.</span></h2>
          <p>
            Newsroom Screen turns today&apos;s stored results into a big-screen briefing: rolling
            24-hour engagement leaders first, then the top content on each platform.
          </p>
        </div>
        <div className={styles.newsroomWrap}>
          <NewsroomScreen />
        </div>
        <div className={styles.darkFacts}>
          <div><strong>24h</strong><span>rolling engagement view</span></div>
          <div><strong>9</strong><span>supported public platforms</span></div>
          <div><strong>5m</strong><span>screen reread from stored data</span></div>
          <div><strong>0</strong><span>extra vendor calls from the display</span></div>
        </div>
      </section>

      <section className={styles.trustSection}>
        <div className={styles.trustCopy}>
          <p className={styles.eyebrow}>Intelligence you can defend</p>
          <h2>Facts before prose.</h2>
          <p>
            Data Dumpster does not let an AI improvise your numbers. Every numeric claim starts
            with a fact sheet computed in code and is checked against that sheet before it renders.
          </p>
          <ul>
            <li><ShieldCheck size={20} /> Missing data stays missing—not zero.</li>
            <li><ShieldCheck size={20} /> Audience is treated as a point-in-time stock.</li>
            <li><ShieldCheck size={20} /> Coverage limits travel with the result.</li>
            <li><ShieldCheck size={20} /> Your organization chooses its model provider.</li>
          </ul>
        </div>
        <div className={styles.factSheet}>
          <div className={styles.factSheetHead}>
            <span><Sparkles size={16} /> Verified briefing</span>
            <em>FACT SHEET MATCH</em>
          </div>
          <blockquote>
            “The Harbor Journal led the landscape in total engagement, driven by two Instagram
            posts that performed well above its account median.”
          </blockquote>
          <div className={styles.factRows}>
            <div><span>Landscape leader</span><strong>The Harbor Journal</strong><i>Verified</i></div>
            <div><span>Total engagement</span><strong>48,231</strong><i>Verified</i></div>
            <div><span>Primary channel</span><strong>Instagram</strong><i>Verified</i></div>
          </div>
          <p><ShieldCheck size={15} /> Every printed number matched the computed source.</p>
        </div>
      </section>

      <section className={styles.featureSection}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>From signal to action</p>
          <h2>Made for the way<br /><span>newsrooms actually work.</span></h2>
        </div>
        <div className={styles.featureGrid}>
          {featureCards.map(({ icon: Icon, kicker, title, body }) => (
            <article key={title} className={styles.featureCard}>
              <span className={styles.featureIcon}><Icon size={23} /></span>
              <p>{kicker}</p>
              <h3>{title}</h3>
              <span>{body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.closingSection}>
        <div className={styles.closingMark}><DumpsterMark className="h-10 w-10" /></div>
        <p className={styles.eyebrow}>Data Dumpster</p>
        <h2>Less dashboard.<br />More direction.</h2>
        <p>See the competitive landscape, understand the signal and walk into the room ready.</p>
        <Link href="/login" className={styles.primaryAction}>
          Open Data Dumpster <ArrowRight size={17} />
        </Link>
      </section>
    </main>
  );
}
