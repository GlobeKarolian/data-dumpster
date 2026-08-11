import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Layers3,
  MonitorUp,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DumpsterMark } from '@/components/shell/logo';
import styles from './training.module.css';

export const metadata: Metadata = {
  title: 'Training center',
  description:
    'Get newsroom-ready with the Data Dumpster quick-start guide, facilitator deck, workflows, metric definitions and evidence guardrails.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about/training' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Data Dumpster Training Center',
    description: 'Learn how to turn competitive social data into a newsroom decision.',
    type: 'website',
    url: 'https://pressbox-kappa.vercel.app/about/training',
    images: [
      {
        url: 'https://pressbox-kappa.vercel.app/product/data-dumpster-social.png',
        width: 1200,
        height: 630,
        alt: 'Data Dumpster competitive intelligence for newsrooms',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Data Dumpster Training Center',
    description: 'Learn the product, read the evidence and bring the signal into the newsroom.',
    images: ['https://pressbox-kappa.vercel.app/product/data-dumpster-social.png'],
  },
};

const orientationSteps = [
  {
    number: '01',
    icon: Layers3,
    title: 'Choose the landscape.',
    body: 'Start with the market or owned-brand group that matches the question you are trying to answer.',
  },
  {
    number: '02',
    icon: Clock3,
    title: 'Set the window.',
    body: 'Use the same dates for every comparison. A result is only meaningful inside a clearly defined window.',
  },
  {
    number: '03',
    icon: BarChart3,
    title: 'Find the movement.',
    body: 'Scan the leaders, changes and channel mix before deciding what deserves a deeper look.',
  },
  {
    number: '04',
    icon: Search,
    title: 'Open the evidence.',
    body: 'Move from the chart to the post card, media, copy and source link before drawing a conclusion.',
  },
] as const;

const newsroomMoments = [
  {
    label: 'Every morning',
    title: 'See what moved overnight.',
    body: 'Use Newsroom Screen or Cross-Channel to spot the brands and posts generating the most engagement in the last 24 hours.',
  },
  {
    label: 'During the week',
    title: 'Investigate the pattern.',
    body: 'Filter by platform and company, open the winning posts, and compare formats, topics and publishing behavior.',
  },
  {
    label: 'Before leadership',
    title: 'Package the answer.',
    body: 'Recompute the Weekly Report, add newsroom context, and share one snapshot with the underlying evidence attached.',
  },
] as const;

const guardrails = [
  {
    title: 'Audience is a snapshot.',
    body: 'Follower counts describe the latest measured audience inside the window. They are never added together across days.',
  },
  {
    title: 'Blank is not zero.',
    body: 'A missing comparison means the baseline or coverage is not defensible. Data Dumpster leaves it blank instead of inventing certainty.',
  },
  {
    title: 'Coverage travels with the result.',
    body: 'Source limitations and incomplete windows stay visible so users know exactly how much confidence to place in a number.',
  },
  {
    title: 'Every claim keeps its evidence.',
    body: 'Reported figures are computed in code, stored with the report and verified before generated language reaches the reader.',
  },
] as const;

export default function TrainingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroSignal} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Data Dumpster training center</p>
          <h1>Start with the question.<br /><span>End with the evidence.</span></h1>
          <p>
            Everything your newsroom needs to use Data Dumpster confidently—from the first
            landscape switch to the report you bring into the room.
          </p>
          <div className={styles.heroActions}>
            <a
              href="/training/Data-Dumpster-Newsroom-Quick-Start.docx"
              download
              className={styles.primaryAction}
            >
              Download quick start <Download size={17} />
            </a>
            <Link href="/login" className={styles.secondaryAction}>
              Open Data Dumpster <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <div className={styles.orientation} aria-label="Four-step Data Dumpster orientation">
          <div className={styles.orientationTop}>
            <span><DumpsterMark className="h-5 w-5" /> The four-minute workflow</span>
            <em>START HERE</em>
          </div>
          <div className={styles.orientationGrid}>
            {orientationSteps.map(({ number, icon: Icon, title, body }) => (
              <article key={number}>
                <div><span>{number}</span><Icon size={20} /></div>
                <h2>{title}</h2>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.resources} id="resources">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Ready-to-use materials</p>
          <h2>Learn it yourself.<br /><span>Teach it to the room.</span></h2>
          <p>Use the desk reference for daily work or run the complete newsroom session with the presenter deck.</p>
        </div>
        <div className={styles.resourceGrid}>
          <article className={styles.resourceCard}>
            <div className={styles.resourceIcon}><BookOpen size={31} /></div>
            <span>Desk reference · Microsoft Word</span>
            <h3>Newsroom Quick-Start Guide</h3>
            <p>
              Eight practical pages covering daily use, weekly reports, Newsroom Screen,
              evidence labels and the data-quality guardrails.
            </p>
            <ul>
              <li><CheckCircle2 size={17} /> Built for self-guided onboarding</li>
              <li><CheckCircle2 size={17} /> Keep it open beside the product</li>
              <li><CheckCircle2 size={17} /> Easy to edit for team-specific notes</li>
            </ul>
            <a href="/training/Data-Dumpster-Newsroom-Quick-Start.docx" download>
              Download the guide <Download size={17} />
            </a>
          </article>
          <article className={`${styles.resourceCard} ${styles.resourceCardDark}`}>
            <div className={styles.resourceIcon}><Presentation size={31} /></div>
            <span>Facilitator kit · Microsoft PowerPoint</span>
            <h3>Newsroom Training Deck</h3>
            <p>
              A complete 35–40 minute team session with fourteen slides, speaker notes,
              verified product screenshots and a ten-minute guided exercise.
            </p>
            <ul>
              <li><CheckCircle2 size={17} /> Present slides 1–12 in 20–25 minutes</li>
              <li><CheckCircle2 size={17} /> Run the guided live exercise</li>
              <li><CheckCircle2 size={17} /> Close with next steps and the guide</li>
            </ul>
            <a href="/training/Data-Dumpster-Newsroom-Training.pptx" download>
              Download the deck <Download size={17} />
            </a>
          </article>
        </div>
      </section>

      <section className={styles.moments}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>A repeatable newsroom habit</p>
          <h2>Three moments.<br /><span>One connected workflow.</span></h2>
        </div>
        <div className={styles.momentGrid}>
          {newsroomMoments.map((moment, index) => (
            <article key={moment.label}>
              <span>{String(index + 1).padStart(2, '0')} · {moment.label}</span>
              <h3>{moment.title}</h3>
              <p>{moment.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.guardrailSection}>
        <div className={styles.guardrailIntro}>
          <p className={styles.eyebrow}>Read the data correctly</p>
          <h2>Confidence comes<br /><span>from knowing the limits.</span></h2>
          <p>
            Data Dumpster is designed to make uncertainty visible. These four rules prevent the
            most common social-analytics mistakes.
          </p>
        </div>
        <div className={styles.guardrailGrid}>
          {guardrails.map(({ title, body }) => (
            <article key={title}>
              <ShieldCheck size={22} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.helpSection}>
        <div className={styles.helpCopy}>
          <p className={styles.eyebrow}>When you need an answer</p>
          <h2>Use the tool.<br /><span>Then use the team.</span></h2>
          <p>
            Start with the definitions and evidence inside each screen. If the source itself is
            incomplete, the product will say so plainly rather than hiding the limitation.
          </p>
        </div>
        <div className={styles.helpCards}>
          <article>
            <FileText size={23} />
            <div><strong>Need the metric definition?</strong><span>Use the information icon next to the number.</span></div>
          </article>
          <article>
            <Sparkles size={23} />
            <div><strong>Need to explain the result?</strong><span>Open the post card and keep the evidence attached.</span></div>
          </article>
          <article>
            <MonitorUp size={23} />
            <div><strong>Need to bring it to a meeting?</strong><span>Recompute and share the Weekly Report snapshot.</span></div>
          </article>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={styles.closingMark}><DumpsterMark className="h-9 w-9" /></div>
        <p className={styles.eyebrow}>You are ready</p>
        <h2>Find the signal.<br />Show your work.</h2>
        <p>Choose a landscape, set the window and open the evidence behind the result.</p>
        <div className={styles.heroActions}>
          <Link href="/login" className={styles.primaryAction}>
            Open Data Dumpster <ExternalLink size={17} />
          </Link>
          <Link href="/about" className={styles.secondaryAction}>Explore the product</Link>
        </div>
      </section>
    </main>
  );
}
