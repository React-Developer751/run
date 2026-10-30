import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE_NAME, SITE_URL, pageMetadata } from '@/lib/site';
import { Nav } from '@/components/Nav';

const LANDING_TITLE = 'HostX — Deploy your MERN app from GitHub in minutes';
const LANDING_DESCRIPTION =
  'Deploy React frontends and Node/Express APIs from GitHub with your MongoDB Atlas database, free HTTPS and custom domains. Apps never sleep. Start free.';

export const metadata: Metadata = pageMetadata({ title: LANDING_TITLE, description: LANDING_DESCRIPTION, path: '/', absoluteTitle: true });

// Structured data for search engines: who we are and what the product is.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon.svg` },
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      description: LANDING_DESCRIPTION,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
    },
  ],
};

const STEPS = [
  { n: '1', title: 'Pick your repo', text: 'Connect GitHub and choose any repository — public or private — or paste a public link.' },
  { n: '2', title: 'Pick a folder', text: 'We scan for every package.json. Choose backend/ or frontend/ from a dropdown — no typing paths.' },
  { n: '3', title: 'Build & isolate', text: 'Dependencies install, the app builds, and it starts in its own container. Connect MongoDB Atlas with one environment variable.' },
  { n: '4', title: 'Go live', text: 'You get an HTTPS subdomain (or your own domain) and every push to GitHub redeploys automatically.' },
];

const FEATURES: Array<{ icon: IconName; title: string; text: string; span: string }> = [
  { icon: 'layers', title: 'Monorepo-aware', text: 'Frontend and backend in one repo? Scan it, then deploy each folder as its own service — each gets its own URL.', span: 'span-4' },
  { icon: 'terminal', title: 'Live build logs', text: 'Watch every step — clone, install, build, start — as it happens.', span: 'span-2' },
  { icon: 'shield', title: 'Docker isolation', text: 'Each app runs in a container with a memory cap, CPU limit and process limit. One bad app never takes the server down.', span: 'span-2' },
  { icon: 'globe', title: 'HTTPS & custom domains', text: 'A free my-app subdomain with HTTPS, or connect your own domain — certificates are automatic. WebSockets work too.', span: 'span-2' },
  { icon: 'key', title: 'MongoDB Atlas ready', text: 'Paste your free Atlas connection string as MONGODB_URI — a step-by-step guide shows you how. Just mongoose.connect().', span: 'span-2' },
  { icon: 'refresh', title: 'Never sleeps, never breaks', text: 'Apps stay on 24/7. Redeploys are zero-downtime, crashes restart automatically, and you can roll back in one click.', span: 'span-3' },
  { icon: 'bolt', title: 'Private repos & auto-deploy', text: 'Connect GitHub once. Every push to your branch goes live on its own; a failed build never replaces a working version.', span: 'span-3' },
];

export default function Landing() {
  return (
    <>
      <Nav variant="site" />

      <main>
      <header className="hero">
        <div className="container">
          <div className="eyebrow">
            <span>Free plan</span> MERN hosting for students &amp; indie devs
          </div>
          <h1>
            Ship your MERN app. <br />
            <span className="serif grad-text">Just paste a link.</span>
          </h1>
          <p className="lead">
            HostX turns a GitHub repository into a live app — React frontends and Node/Express APIs connected to your MongoDB
            Atlas database, with HTTPS, auto-deploys and real build logs. Your apps never sleep. Start free, no credit card.
          </p>
          <div className="hero-cta">
            <Link href="/register" className="btn btn-primary btn-lg">
              Start deploying <Icon name="arrow" />
            </Link>
            <a href="#how" className="btn btn-lg">See how it works</a>
          </div>

          <div className="terminal" aria-label="Example deployment log">
            <div className="terminal-bar">
              <i /><i /><i />
              <span>hostx — deploy my-portfolio</span>
            </div>
            <div className="terminal-body">
              <div className="t-line" style={{ animationDelay: '0.3s' }}><span className="k">❯</span> hostx deploy github.com/you/portfolio</div>
              <div className="t-line" style={{ animationDelay: '1.0s' }}><span className="d">[hostx]</span> Scanning repository… found <span className="k">frontend/</span>, <span className="k">backend/</span></div>
              <div className="t-line" style={{ animationDelay: '1.8s' }}><span className="d">[hostx]</span> Detected Vite · static site</div>
              <div className="t-line" style={{ animationDelay: '2.6s' }}><span className="d">[hostx]</span> npm install <span className="d">· 167 packages</span></div>
              <div className="t-line" style={{ animationDelay: '3.4s' }}><span className="d">[hostx]</span> npm run build <span className="d">· ✓ 33 modules transformed</span></div>
              <div className="t-line" style={{ animationDelay: '4.2s' }}><span className="d">[hostx]</span> Starting in isolated container <span className="d">· 512 MB</span></div>
              <div className="t-line" style={{ animationDelay: '5.0s' }}><span className="ok">✓ Live</span> https://my-portfolio.hostx.app</div>
            </div>
          </div>
        </div>
      </header>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <span className="tag">How it works</span>
            <h2>From link to live in <span className="serif grad-text">four steps</span></h2>
            <p>The same flow you know from Render — and your app never goes to sleep.</p>
          </div>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="card step card-hover" key={s.n}>
                <span className="num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="features" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <span className="tag">Features</span>
            <h2>Everything a small team <span className="serif grad-text">actually needs</span></h2>
          </div>
          <div className="bento">
            {FEATURES.map((f, i) => (
              <div className={`card card-hover ${f.span}`} key={f.title}>
                <div className="feature-icon"><Icon name={f.icon} /></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                {i === 0 && (
                  <div className="folder-demo" aria-hidden="true">
                    <div><Icon name="folder" /> Root folder (.) <em>Express · web service</em></div>
                    <div className="sel"><Icon name="folder" /> backend/ <em>Express · web service</em></div>
                    <div><Icon name="folder" /> frontend/ <em>Vite · static site</em></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="cta-band">
            <h2>Your next project deserves <span className="serif grad-text">a real URL.</span></h2>
            <p>Create a free account and deploy your first repo in minutes.</p>
            <Link href="/register" className="btn btn-primary btn-lg">
              Create free account <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      </main>

      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
    </>
  );
}
