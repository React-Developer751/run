import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE_NAME, SITE_URL, pageMetadata } from '@/lib/site';
import { Nav } from '@/components/Nav';
import { Testimonials } from '@/components/Testimonials';

const LANDING_TITLE = 'HostX — Deploy your MERN app from GitHub in minutes';
const LANDING_DESCRIPTION =
  'Deploy React frontends and Node/Express APIs from GitHub with your MongoDB Atlas database, free HTTPS and custom domains. No cold starts. Start free.';

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
  { icon: 'refresh', title: 'Never sleeps, never breaks', text: 'No 15-minute sleep and no cold starts: apps stay on while people use them (free web services pause only after 7 days without a single visit). Redeploys are zero-downtime, crashes restart automatically, and you can roll back in one click.', span: 'span-3' },
  { icon: 'bolt', title: 'Private repos & auto-deploy', text: 'Connect GitHub once. Every push to your branch goes live on its own; a failed build never replaces a working version.', span: 'span-3' },
];

// What HostX detects and runs today: static builds (Vite, CRA) and Node.js servers.
const STACK = ['React', 'Vite', 'Create React App', 'Vue', 'Svelte', 'Next.js', 'Express', 'Fastify', 'NestJS', 'Socket.IO', 'Mongoose', 'Prisma'];

// Illustrative dashboard snapshot (not live data): what a typical MERN account looks like after a week.
const PREVIEW: Array<{ name: string; url: string; status: 'Live' | 'Deploying' | 'Paused'; type: 'Web Service' | 'Static Site'; runtime: string; branch: string; at: string }> = [
  { name: 'shopkart-api', url: 'shopkart-api.hostx.app', status: 'Live', type: 'Web Service', runtime: 'Express · Node 22', branch: 'main', at: '3 min ago' },
  { name: 'shopkart-web', url: 'shopkart.in', status: 'Live', type: 'Static Site', runtime: 'Vite + React', branch: 'main', at: '3 min ago' },
  { name: 'campus-chat', url: 'campus-chat.hostx.app', status: 'Deploying', type: 'Web Service', runtime: 'Socket.IO · Node 20', branch: 'dev', at: 'just now' },
  { name: 'portfolio', url: 'portfolio-ankit.hostx.app', status: 'Live', type: 'Static Site', runtime: 'Vite', branch: 'main', at: '2 days ago' },
  { name: 'expense-tracker-api', url: 'expense-api.hostx.app', status: 'Paused', type: 'Web Service', runtime: 'Express · Node 22', branch: 'main', at: '9 days ago' },
];

const EXAMPLES: Array<{ title: string; repo: string; tree: string[]; result: string[] }> = [
  {
    title: 'MERN e-commerce',
    repo: 'github.com/you/shopkart',
    tree: ['backend/ — Express + Mongoose', 'frontend/ — Vite + React', '.env → MONGODB_URI, JWT_SECRET'],
    result: ['shopkart-api → Web Service', 'shopkart-web → Static Site + your domain', 'Push to main → both redeploy'],
  },
  {
    title: 'Real-time chat',
    repo: 'github.com/you/campus-chat',
    tree: ['server.js — Express + Socket.IO', 'package.json — "start": "node server.js"', 'client/ — React'],
    result: ['WebSockets work out of the box', 'One URL for API and sockets', 'Crash → automatic restart'],
  },
  {
    title: 'Final-year project API',
    repo: 'github.com/you/attendance-api',
    tree: ['src/ — NestJS', 'engines.node: "20.x"', 'Atlas M0 free cluster'],
    result: ['Node 20 picked from engines', 'Logs for your viva demo', 'Rollback if a commit breaks it'],
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Is the free plan really free?', a: 'Yes. 5 Web Services and 10 Static Sites with HTTPS, auto-deploys and build logs. No credit card. A free web service that gets no visits for 7 days is paused; you resume it from the dashboard in one click. Static sites are never paused.' },
  { q: 'Do my apps sleep like on other free hosts?', a: 'No. There is no 15-minute sleep and no cold start: while people use your app it stays running. Only an app nobody has opened for a full week is paused, and nothing is deleted.' },
  { q: 'Where does my MongoDB database live?', a: 'In your own MongoDB Atlas account (the free M0 cluster is enough to start). Paste the connection string as MONGODB_URI in Environment; the dashboard has a step-by-step guide including the IP address to allow.' },
  { q: 'Can I deploy a private GitHub repository?', a: 'Yes. Connect GitHub once and choose which repositories HostX may read. Every push to your branch then redeploys automatically; a failed build never replaces the version that is live.' },
  { q: 'My repo has frontend and backend folders. How do I deploy it?', a: 'Deploy it twice: pick backend/ as a Web Service and frontend/ as a Static Site. HostX scans the repository and lists every folder with a package.json, so there are no paths to type.' },
  { q: 'What happens if I need help?', a: 'Open Support in your dashboard. Requests go straight to the HostX team and replies appear there (and by email). Mark it Emergency if a live app is down.' },
];

const FAQ_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

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
            Atlas database, with HTTPS, auto-deploys and real build logs. No cold starts. Free plan: 5 web services + 10 static sites, no credit card.
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

      <section className="stack-strip" aria-label="Works with">
        <div className="container">
          <span className="dim">Works with</span>
          <ul>{STACK.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <span className="tag">How it works</span>
            <h2>From link to live in <span className="serif grad-text">four steps</span></h2>
            <p>The same flow you know from Render, without the cold starts.</p>
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

      <section className="section" id="dashboard" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <span className="tag">The dashboard</span>
            <h2>Every service, <span className="serif grad-text">one clear list</span></h2>
            <p>Status, runtime, branch and last deploy at a glance. Filter by active, paused, archived or failed.</p>
          </div>
          <div className="preview-window" aria-label="Example dashboard (illustration)">
            <div className="terminal-bar"><i /><i /><i /><span>hostx.app/dashboard · example</span></div>
            <div className="table-card">
              <table className="table">
                <thead><tr><th>Service name</th><th>Status</th><th>Type</th><th>Runtime</th><th>Branch</th><th>Updated</th></tr></thead>
                <tbody>
                  {PREVIEW.map((r) => (
                    <tr key={r.name}>
                      <td><div className="cell-main"><b>{r.name}</b><small className="mono">{r.url}</small></div></td>
                      <td><span className={`badge ${r.status === 'Live' ? 'badge-live' : r.status === 'Deploying' ? 'badge-busy' : 'badge-idle'}`}>{r.status}</span></td>
                      <td>{r.type}</td>
                      <td>{r.runtime}</td>
                      <td className="mono">{r.branch}</td>
                      <td>{r.at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="examples" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <span className="tag">Real-world setups</span>
            <h2>Projects developers <span className="serif grad-text">ship on HostX</span></h2>
            <p>Typical repositories and what HostX turns them into. Yours probably looks like one of these.</p>
          </div>
          <div className="examples">
            {EXAMPLES.map((e) => (
              <div className="card card-hover example" key={e.title}>
                <h3>{e.title}</h3>
                <span className="mono dim example-repo"><Icon name="github" /> {e.repo}</span>
                <ul className="example-tree mono">{e.tree.map((t) => <li key={t}>{t}</li>)}</ul>
                <ul className="example-result">{e.result.map((t) => <li key={t}><Icon name="check" /> {t}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="free-plan" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="spec-band card">
            <div>
              <span className="tag" style={{ color: 'var(--accent)' }}>Free plan</span>
              <h2 style={{ fontSize: 'clamp(24px, 3vw, 34px)', marginTop: 8 }}>Enough for a full MERN project. <span className="serif grad-text">₹0.</span></h2>
            </div>
            <dl className="specs">
              <div><dt>5</dt><dd>Web Services</dd></div>
              <div><dt>10</dt><dd>Static Sites</dd></div>
              <div><dt>512 MB</dt><dd>RAM per app</dd></div>
              <div><dt>HTTPS</dt><dd>on every URL</dd></div>
              <div><dt>1</dt><dd>custom domain</dd></div>
              <div><dt>0</dt><dd>cold starts</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <Testimonials />

      <section className="section" id="faq" style={{ paddingTop: 0 }}>
        <div className="container faq">
          <div className="section-head">
            <span className="tag">FAQ</span>
            <h2>Questions developers <span className="serif grad-text">ask us</span></h2>
          </div>
          {FAQ.map((f) => (
            <details className="card faq-item" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }} />
    </>
  );
}
