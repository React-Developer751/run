import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { Nav } from '@/components/Nav';

const LANDING_TITLE = 'HostX — Deploy React & Node.js apps from a GitHub link';
const LANDING_DESCRIPTION =
  'Free, self-hosted mini Render. Paste a GitHub repo, pick a folder and get your React frontend and Node.js backend live on their own subdomain.';

export const metadata: Metadata = {
  title: { absolute: LANDING_TITLE },
  description: LANDING_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', title: LANDING_TITLE, description: LANDING_DESCRIPTION, url: '/' },
  twitter: { card: 'summary_large_image', title: LANDING_TITLE, description: LANDING_DESCRIPTION },
};

const STEPS = [
  { n: '1', title: 'Paste your repo', text: 'Drop in any public GitHub link. HostX takes a shallow clone, so even big repos are quick.' },
  { n: '2', title: 'Pick a folder', text: 'We scan for every package.json. Choose backend/ or frontend/ from a dropdown — no typing paths.' },
  { n: '3', title: 'Build & isolate', text: 'Dependencies install, the app builds, and it starts inside its own sandbox with resource limits.' },
  { n: '4', title: 'Go live', text: 'You get a clean subdomain routed by our built-in reverse proxy. Share it with anyone.' },
];

const FEATURES: Array<{ icon: IconName; title: string; text: string; span: string }> = [
  { icon: 'layers', title: 'Monorepo-aware', text: 'Frontend and backend in one repo? Scan it, then deploy each folder as its own service — each gets its own URL.', span: 'span-4' },
  { icon: 'terminal', title: 'Live build logs', text: 'Watch every step — clone, install, build, start — as it happens.', span: 'span-2' },
  { icon: 'shield', title: 'Docker isolation', text: 'Each app runs in a container with a memory cap, CPU limit and process limit. One bad app never takes the server down.', span: 'span-2' },
  { icon: 'globe', title: 'Instant subdomains', text: 'my-app.yourdomain.com, routed by a dependency-free Node.js reverse proxy with WebSocket support.', span: 'span-2' },
  { icon: 'key', title: 'Environment variables', text: 'Set secrets once. They are injected at build time and runtime.', span: 'span-2' },
  { icon: 'refresh', title: 'Redeploy, stop, start', text: 'A failed redeploy never kills the version that is already serving traffic.', span: 'span-3' },
  { icon: 'bolt', title: 'Zero third-party engine', text: 'The deploy engine is pure Node.js + TypeScript. Nothing to patch, nothing that breaks.', span: 'span-3' },
];

export default function Landing() {
  return (
    <>
      <Nav variant="site" />

      <main>
      <header className="hero">
        <div className="container">
          <div className="eyebrow">
            <span>Free</span> Self-hosted deploys for students &amp; indie devs
          </div>
          <h1>
            Ship your MERN app. <br />
            <span className="serif grad-text">Just paste a link.</span>
          </h1>
          <p className="lead">
            HostX turns a GitHub repository into a live app on its own subdomain — React frontends and Node backends,
            isolated, with real build logs. No credit card. No surprise bills.
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
              <div className="t-line" style={{ animationDelay: '4.2s' }}><span className="d">[hostx]</span> Starting in isolated container <span className="d">· 300 MB</span></div>
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
            <p>The same flow you know from Render — without the paywall.</p>
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
    </>
  );
}
