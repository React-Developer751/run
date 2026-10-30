# HostX — self-hosted mini Render

GitHub link paste karo, folder choose karo, aur React frontend / Node backend apne subdomain pe live.

```
Dashboard (Next.js :3000) ──► HostX Engine API (:4000) ──► git clone → detect → build → run
                                                                   │
Browser ──► <slug>.localhost:8080 ──► Reverse Proxy (:8080) ───────┘  (container / process / static files)
```

## Structure

| Path | Kya hai |
|---|---|
| `src/` | Engine (Node.js + TypeScript, **zero third-party runtime packages**) |
| `web/` | Dashboard (Next.js) |
| `data/` | Runtime state: `db.json` (users, projects), logs, static builds (git-ignored) |
| `apps/` | Cloned repos, `apps/<projectId>/src` (git-ignored) |

Engine layers: `routes → controllers → services`
- `auth.service` — scrypt password hash + HS256 token (sirf `node:crypto`)
- `store.service` — JSON-file DB, atomic writes
- `cloner.service` — shallow `git clone` + repo scan (har `package.json` wala folder)
- `detect.service` — Vite / CRA / Next / Express etc. detect karta hai
- `docker.service` / `process.service` — runners (neeche dekho)
- `deploy.service` — clone → detect → build → start pipeline, build queue, restart recovery
- `proxy.service` — Host-header reverse proxy (HTTP + WebSocket) + static file server

## Run (development)

```bash
# 1) Engine  (API :4000, proxy :8080)
npm install
npm run dev

# 2) Dashboard  (:3000)
cd web && npm install && npm run dev
```

Dashboard kholo: <http://localhost:3000> → account banao → **New deploy**.
Apps `http://<name>.localhost:8080` pe khulte hain (Chrome/Firefox/Safari `*.localhost` khud resolve karte hain).

Production build: `npm run build && npm start` (engine), `cd web && npm run build && npm start`.

## Runners

| Mode | Kab | Isolation |
|---|---|---|
| **Docker** | Docker engine mile to automatic | Har app apne container mein: `--memory=300m --cpus=0.5 --pids-limit=256`, sirf `127.0.0.1` pe publish |
| **Process** | Docker na ho (dev fallback) | **Koi isolation nahi** — repo ka code seedha aapki machine pe chalta hai |

> Is Mac pe Docker install nahi hai, isliye abhi **Process mode** chal raha hai (navbar mein "Dev mode" chip).
> Sirf apni khud ki repos deploy karo. Dusre users ko allow karne se pehle Docker Desktop install karo — tab mode khud `Docker isolated` ho jayega.
> Zabardasti Docker chahiye to `HOSTX_RUNNER=docker`.

Static sites (Vite/CRA): Docker mode mein nginx container; Process mode mein build ke baad proxy khud files serve karta hai (SPA fallback ke saath).

**Build details:** Node.js version `package.json` ke `engines.node` se (18/20/22/24, default **22**). Lockfile se package manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn (corepack), warna npm.

**Zero-downtime deploys (Docker):** har deploy ka apna image tag (`hostx-<id>:<version>`) aur container (`hostx-<id>-<version>`) naye port pe start hota hai. Health check pass hone ke baad hi proxy naye version pe switch karta hai, phir purana container + image delete hota hai (dangling images aur 7 din purana build cache bhi prune). Naya version fail ho to purana chalta rehta hai. Container logs `10m × 3` files tak capped hain.

## Security

**Built in:** scrypt password hashes · **sessions in HttpOnly cookies only** (over https named `__Host-hostx_at` / `__Host-hostx_rt`, so a user's app on a sibling subdomain cannot plant a session cookie; malformed cookies are ignored) (nothing in `localStorage`/JS): 15-min access token + 30-day rotating refresh token, refresh-reuse detection (a replayed old refresh token revokes the whole login), instant server-side logout, CSRF `Origin` check + `SameSite=Lax` · tokens revoked on password change/reset/suspend/delete · login limits per IP *and* per email · global API limit (600 req/min/IP) · deploy limit (30 builds/hour/user) · owner-only project access (same 404 for "missing" and "not yours") · webhook HMAC-SHA256 · env vars & webhook secrets **encrypted at rest** (AES-256-GCM, key derived from `HOSTX_SECRET`) · `data/` is `0700`, files `0600` · server paths hidden from user logs · CSP, HSTS, X-Frame-Options on the dashboard · API on loopback · git clone without symlinks/hooks · one private Docker network per project (users' containers cannot reach each other) with `--cap-drop=ALL`, `no-new-privileges`, memory/CPU/pids/ulimit caps, non-root user · production refuses to start without Docker or with a `HOSTX_SECRET` shorter than 32 chars.

**You must do on the server (cannot be done from code):**

1. **Behind Caddy/nginx set `HOSTX_TRUST_PROXY=true`.** Without it every user shares the proxy's IP in rate limits. Never set it if the API is reachable directly.
2. **Block the cloud metadata endpoint from containers** (otherwise a user's app can steal your VPS credentials): `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP`.
3. Firewall: only 80/443 (+SSH) public. Keep 3000, 4000, 8080 and 5001-5999 closed. Also set `HOSTX_PROXY_HOST=127.0.0.1` so the app proxy only listens for Caddy/nginx.
4. Run the engine as a dedicated user. Docker group membership is root-equivalent, so protect that account (SSH keys only, no password login).
5. **Back up `data/` (db.json + secret.key) together.** Do not change `HOSTX_SECRET` / `secret.key` afterwards: stored env vars become unreadable (they are encrypted with it).
6. Set `HOSTX_ALLOW_SIGNUP=false` once your own accounts exist (open sign-up lets strangers run builds on your CPU).

**Known limits / accepted risks:**

- Docker shares the host kernel. For untrusted public users add gVisor/Sysbox or run HostX on a throwaway VM.
- `docker build` (npm install of user code) is not memory-capped; it has a 10-minute timeout. On a small VPS keep signups closed.
- Auth cookies are `SameSite=Lax`, so the dashboard and the API must share one registrable domain (e.g. `app.example.com` + `api.example.com`). Users' apps live on sibling subdomains, which is why every state-changing request is also checked against the dashboard `Origin`.
- No 2FA yet; admin sees every user's build logs.
- JSON-file database: single process only.

## Login sessions (cookies)

- Login/register set two **HttpOnly** cookies and return only the user (no token in the JSON): `hostx_at` (access JWT, 15 min, `Path=/`) and `hostx_rt` (opaque refresh token, 30 days, `Path=/api/auth`, stored hashed on the server). `Secure` is on in production (`HOSTX_COOKIE_SECURE=true|false|auto`; auto = production, or https via a trusted proxy). Plain `http://localhost` development works without it.
- The frontend never touches tokens. `fetch(..., { credentials: 'include' })` only; on a 401 it calls `POST /api/auth/refresh` once (shared between parallel requests) and retries.
- Every refresh **rotates** the refresh token. Replaying an old one after a 10-second grace window (two tabs racing) is treated as theft and revokes that whole login.
- `POST /api/auth/logout` (this browser), `POST /api/auth/logout-all` (everywhere; button on `/account`). Password change/reset, suspension and deletion revoke sessions immediately.
- Env: `HOSTX_ACCESS_TTL_SECONDS` (900), `HOSTX_REFRESH_TTL_DAYS` (30), `HOSTX_COOKIE_SECURE` (auto). Not signed in after upgrading? Everybody signs in once (old `localStorage` tokens are ignored and cleaned up).

## Account, passwords & sessions

- `/account` par user apna password badal sakta hai. Badalte hi baaki sab devices/sessions sign-out ho jate hain (token `iat` check).
- Password bhool gaya? Admin → Users → 🔑 **Reset password**: random temporary password milta hai (sirf ek baar dikhta hai), user ke saare sessions band ho jate hain.
- Login rate-limit: IP ke hisaab se 20 / 15 min, email ke hisaab se 10 / 15 min.

## SEO

Public pages (`/`, `/register`) indexable hain: unique title, description, canonical, Open Graph/Twitter card, `sitemap.xml`, `robots.txt`, manifest, favicon aur 1200×630 social image. Login ke peeche ke saare pages (`/dashboard`, `/new`, `/projects/*`, `/account`, `/admin/*`) `noindex` hain aur robots.txt mein disallow. Production build se pehle `NEXT_PUBLIC_SITE_URL=https://app.yourdomain.com` set karo (canonical/sitemap/OG isi se bante hain).

## Admin panel (`/admin`)

Pehla account jo register hota hai **admin** banta hai (ya `HOSTX_ADMIN_EMAIL` wala email). Purane accounts mein sabse purana user admin ban jata hai. Admin ko navbar mein **Admin** link dikhta hai:

| Page | Kya kar sakte ho |
|---|---|
| Overview | users/projects/deployments ke counts, 24h failure rate, 7-din ka deployment chart, memory/CPU/ports/disk |
| Users | search, make/remove admin, per-user project limit, suspend/reactivate (apps turant offline), delete user + uske projects |
| Projects | sab users ke projects: status filter, logs (build + runtime), redeploy, stop/start, delete |
| Deployments | latest 100 deployments, failed filter, har ek ka log |
| Settings | signups on/off, default project limit (restart ke bina) |
| Audit log | kisne kya kiya (user/project/settings changes) |

Safeguards: apne aap ko demote/suspend/delete nahi kar sakte, kam se kam ek active admin hamesha rehta hai, admin list mein env values/secrets nahi dikhte, aur har admin action audit log mein jata hai.

## Theme

Default **Daylight Aurora** (light: lavender-white, indigo → pink gradient). Navbar ke sun/moon button se **Midnight Indigo** (dark) — choice browser mein save rehti hai. Saare colors `web/app/globals.css` ke top ke tokens mein hain.

## Domains: dashboard aur apps alag rakho

Render ki tarah (`render.com` vs `onrender.com`) do domains use karo:

| Domain | Kya chalta hai |
|---|---|
| `app.yourdomain.com`, `api.yourdomain.com` | Dashboard + API (aapka trusted code) |
| `<slug>.yourapps.app` | Users ki apps (`HOSTX_BASE_DOMAIN=yourapps.app`) |

Kyun: same registrable domain par user ki app dashboard ke liye cookies set kar sakti hai, aur ek phishing app aapka poora main domain Google Safe Browsing / spam lists mein block karwa sakti hai. Production mein engine start hi nahi hota agar dono domain same hon (`HOSTX_ALLOW_SHARED_DOMAIN=true` se override). `yourapps.app` aur `www.yourapps.app` dashboard par redirect hote hain. Live hone ke baad apps domain ko <https://publicsuffix.org> par submit karo (browsers phir har app ko alag site maanenge). Caddy config: `deploy/Caddyfile`.

## MongoDB add-on

Har web service ek click mein apna private MongoDB database le sakti hai (New deploy par "Add a MongoDB database", ya project → **Database** tab).

- Ek shared `mongo:8.0` container (`hostx-mongo`, data volume `hostx-mongo-data`, memory cap `HOSTX_MONGO_MEMORY`). Host par koi port publish nahi hota.
- Har project ka apna database `db_<id>` + user `u_<id>` jo sirf usi database ko padh/likh sakta hai. Mongo sirf un projects ke private Docker network se judta hai jinke paas database hai, isliye apps phir bhi ek dusre tak nahi pahunch sakti.
- App ko `MONGODB_URI` aur `MONGO_URI` milte hain (agar user ne khud set nahi kiye, jaise Atlas URI). Code: `mongoose.connect(process.env.MONGODB_URI)`. Database banane ke baad redeploy karna hota hai.
- Static sites ko URI **kabhi nahi** milta (wo browser JavaScript mein dikh jata). Docker image build args mein bhi nahi jata, sirf runtime par.
- Password `db.json` mein encrypted (AES-256-GCM). Mongo root password `data/mongo-root.key` mein.
- Project delete = database + uska saara data delete.
- Docker ke bina (dev): `HOSTX_MONGO_ADMIN_URI=mongodb://admin:pass@localhost:27017/?authSource=admin` aur `mongosh` install karo. `HOSTX_MONGO=off` se band.

**Aapko server par karna hoga:** roz backup, e.g. cron mein
`docker exec -i hostx-mongo sh -c 'mongodump -u root -p "$(cat)" --authenticationDatabase admin --archive --gzip' < data/mongo-root.key > /backups/mongo-$(date +%F).gz`.
Abhi per-database storage quota nahi hai (MongoDB khud support nahi karta): admin disk usage dekhte rahein.

## Email (verification + forgot password)

- Sign-up par confirmation link jata hai (24 ghante valid). Unverified account login kar sakta hai lekin **deploy nahi** (dashboard mein "Resend email" banner). Pehla account (owner) aur admins kabhi block nahi hote; purane accounts verified maane jaate hain.
- Login page → **Forgot password?** → email link (1 ghanta, ek baar). Reset ke baad saare devices sign-out. Unknown email par bhi wahi jawab, taaki koi emails check na kar sake.
- Emails par rate limit: 3/ghanta per account.
- Koi bhi SMTP provider (Brevo, Amazon SES, Resend, Postmark, Mailgun, Gmail app password):
  `HOSTX_SMTP_URL=smtps://user:pass@smtp.provider.com:465` (ya `smtp://...:587` STARTTLS; bina TLS ke sirf localhost par). User/pass mein `@` ho to `%40` likho. `HOSTX_MAIL_FROM="HostX <no-reply@yourdomain.com>"`.
- SMTP set hote hi verification zaroori ho jata hai (`HOSTX_REQUIRE_VERIFIED_EMAIL=true|false` se badlo). Development mein SMTP na ho to email engine log mein print hota hai.
- Domain par SPF/DKIM/DMARC records lagao (provider batata hai), warna mails spam mein jayenge.

**CAPTCHA (optional, Cloudflare Turnstile, free):** engine mein `HOSTX_TURNSTILE_SECRET`, dashboard build mein `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Sign-up aur forgot-password par lagta hai.

## GitHub App (private repos + instant deploys)

Users "Connect GitHub" karke apni private repos deploy kar sakte hain. HostX sirf wahi repos padh sakta hai jo user GitHub par chunta hai, aur har clone ek 1-ghante ke installation token se hota hai (token clone URL, `.git/config`, logs ya `ps` mein kabhi nahi dikhta). Ek hi webhook se saari connected repos par push → deploy.

**Setup (ek baar):** GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**
- Homepage URL: `https://app.yourdomain.com`
- Callback URL: `https://api.yourdomain.com/api/auth/github/callback` ✅ **"Request user authorization (OAuth) during installation"** on
- Setup URL: khali chhodo · Webhook URL: `https://api.yourdomain.com/api/github/webhook`, ek random webhook secret
- Permissions → Repository: **Contents: Read-only**, Metadata: Read-only. Events: **Push**
- "Any account" par installable rakho (public SaaS ke liye)
- Banne ke baad private key (.pem) download karo

Engine env: `HOSTX_GITHUB_APP_ID`, `HOSTX_GITHUB_APP_SLUG` (URL wala naam), `HOSTX_GITHUB_CLIENT_ID`, `HOSTX_GITHUB_CLIENT_SECRET`, `HOSTX_GITHUB_WEBHOOK_SECRET`, aur `HOSTX_GITHUB_PRIVATE_KEY_FILE=/opt/hostx/github-app.pem` (ya poori PEM `HOSTX_GITHUB_PRIVATE_KEY` mein, `\n` ke saath). git >= 2.31 chahiye.

Security: callback par installation id par bharosa nahi kiya jata. OAuth code se GitHub se poocha jata hai ki is GitHub user ko kaunsi installations dikhti hain, aur signed `state` usi HostX user ka hona chahiye jo signed-in hai. Public repos bina connect kiye pehle jaisi chalti hain.

## Crash monitor + alerts

Har 30 second engine har chalti app check karta hai:
- **Docker:** container crash hone par Docker use khud restart karta hai (`unless-stopped`); HostX ise pakad kar project ki **Recent activity** (Runtime logs tab) mein likhta hai: exit code, ya "out of memory". Container band hi rahe to status **Crashed**, proxy saaf "This app crashed" page dikhata hai, aur wapas chalne par apne aap **Live** + "recovered".
- **Process mode (dev):** HostX khud restart karta hai (10 min mein max 3 baar), phir Crashed.
- Owner ko email: crash par, aur **auto-deploy fail** hone par (har app ke liye ghante mein max 1 email per type). SMTP chahiye.
- Crashed app par **Restart** button; redeploy ya rollback bhi kar sakte ho.

## One-click rollback

Har successful Docker deploy ki image rakhi jati hai (latest 3, `limits.rollbackImages`). Deployments tab mein purana version chuno → **Roll back to this version**: wahi image naye container mein start hoti hai (koi clone/build nahi, kuch second), health check ke baad traffic switch, purana version hata diya jata hai. Current env vars use hote hain. "Serving" tag batata hai abhi kaunsa deployment live hai.

Rollback ke baad auto-deploy use turant undo nahi karta: polling "aakhri dekhe gaye commit" se compare karta hai, isliye agla deploy **naye push** par hi hoga. Process mode mein rollback nahi hai (wahan images nahi bantin).

## Custom domains (free SSL)

Project → **Domains** tab → `www.myshop.com` add karo. User ko do DNS records dikhte hain (copy buttons ke saath):

| Type | Name | Value | Kyun |
|---|---|---|---|
| TXT | `_hostx-challenge.www.myshop.com` | `hostx-verify=...` | Ownership proof: koi doosre ka domain apne project par nahi jod sakta |
| CNAME | `www.myshop.com` | `<slug>.yourapps.app` | Traffic HostX par lana |

Root domain (`myshop.com`) ke liye `HOSTX_PUBLIC_IP` set ho to A record dikhta hai, warna www ya ALIAS/flattening (Cloudflare) ki salah.

- Engine pending domains ko har 5 min apne aap check karta hai (7 din tak); "Check now" button bhi hai. DNS check public resolvers (`HOSTX_DNS_SERVERS`, default 1.1.1.1, 8.8.8.8) se hota hai.
- Verify hote hi proxy us Host ko project par bhejta hai. Ek verified domain sirf ek project par; doosre projects ke pending claims hat jaate hain.
- **SSL:** Caddy ka *on-demand TLS*. Pehli visit par Let's Encrypt certificate banta hai, lekin sirf tab jab `GET /api/domains/check?domain=` 200 de (sirf verified custom domains aur maujooda app subdomains). Isse koi bhi random domains ke certificate mangwa kar Let's Encrypt limits khatam nahi kar sakta. Config: `deploy/Caddyfile` (global `on_demand_tls` + `https://` block). Server par port 80 aur 443 khule hone chahiye.
- Plan limits: Free 1, Starter 3, Pro 10 domains (`HOSTX_*_DOMAINS`).

## Plans & billing (Razorpay)

| Plan | Price | Projects | RAM / CPU per app | MongoDB | Custom domains | Sleep |
|---|---|---|---|---|---|---|
| Free | ₹0 | 2 | 256 MB / 0.25 | 1 | 1 | 15 min idle ke baad |
| Starter | ₹299/mo | 5 | 512 MB / 0.5 | 3 | 3 | Kabhi nahi |
| Pro | ₹999/mo | 15 | 1 GB / 1 | 10 | 10 | Kabhi nahi |

Sab env se badal sakte ho (`HOSTX_PRICE_STARTER`, `HOSTX_FREE_PROJECTS`, `HOSTX_PRO_MEMORY`, `HOSTX_FREE_SLEEP_MINUTES` ...; dekho `src/config/plans.ts`). **Billing tabhi on hoti hai jab Razorpay keys set hon.** Bina keys ke purana behaviour (HOSTX_MAX_PROJECTS, HOSTX_APP_MEMORY, koi sleep nahi) waisa hi rehta hai. Admins par plan limits nahi lagti.

- User **Billing** page → Upgrade → Razorpay ka hosted payment page (UPI autopay, card, netbanking). Plan sirf **signed webhook** aane par badalta hai (browser par bharosa nahi). Duplicate webhooks ignore hote hain.
- Paid plans ke beech switch: same subscription update hota hai (Razorpay prorate karta hai). Cancel: paid period khatam hone tak plan rehta hai, phir Free.
- Renewal fail: Razorpay retry karta hai, tab tak plan rehta hai. Halted/cancelled → Free.
- Plan badalte hi chal rahe containers ki RAM/CPU **bina restart** ke badal jaati hai (`docker update`). Downgrade par purane extra projects delete nahi hote, bas naye nahi ban sakte.
- **Free tier sleep:** web service 15 min bina request ke rahe to stop ho jati hai (status *Sleeping*). Agli request aate hi proxy use start karke wahi request serve karta hai (Docker mein kuch second). Static sites kabhi sleep nahi hoti.
- Admin → Users mein har user ka plan haath se set kar sakte ho (free upgrade, koi charge nahi).
- Public `/pricing` page (sitemap mein).

**Setup:** Razorpay Dashboard → Subscriptions → **Plans**: "Starter" ₹299 monthly aur "Pro" ₹999 monthly banao, unke `plan_...` ids lo. Settings → API Keys, aur Settings → **Webhooks**: URL `https://api.yourdomain.com/api/billing/webhook`, secret set karo, events: `subscription.activated, charged, updated, pending, halted, cancelled, completed, paused, resumed`. Pehle **Test mode** keys se poora flow try karo.

## Auto-deploy (git push → automatic update)

Har project mein **Auto-deploy** default ON hai. Do tarike, dono saath chalte hain:

1. **Polling (koi setup nahi):** engine har `HOSTX_POLL_SECONDS` (default 60s) mein `git ls-remote` se branch ka latest commit dekhta hai. Naya commit mile to khud redeploy (deployment list mein "Auto-deploy · new commit"). Localhost par bhi chalta hai. Failed auto-deploy ke baad 5 min tak dobara try nahi karta.
2. **GitHub webhook (turant, optional):** project → Settings → Auto-deploy mein Payload URL + Secret milta hai. GitHub repo → Settings → Webhooks → Add webhook: content type `application/json`, event "Just the push event". Signature HMAC-SHA256 se verify hota hai, sirf watched branch ke push par deploy hota hai. Iske liye API internet se reachable honi chahiye (`HOSTX_API_PUBLIC_URL` set karo).

Purana live version tab tak chalta rehta hai jab tak naya deploy successful na ho; failed auto-deploy purana version nahi girata.

## Configuration (env vars)

| Var | Default | |
|---|---|---|
| `HOSTX_API_PORT` | `4000` | Engine API |
| `HOSTX_PROXY_PORT` | `8080` | App reverse proxy (live server pe `80`) |
| `HOSTX_PROXY_HOST` | all interfaces | Production mein `127.0.0.1` (sirf Caddy/nginx proxy tak pahunche) |
| `HOSTX_BASE_DOMAIN` | `localhost` | Apps `<slug>.<domain>` pe. Production mein dashboard se **alag** domain |
| `HOSTX_ALLOW_SHARED_DOMAIN` | `false` | Same domain par apps chalane ki zabardasti (not recommended) |
| `HOSTX_MONGO` / `HOSTX_MONGO_IMAGE` | `on` / `mongo:8.0` | MongoDB add-on |
| `HOSTX_MONGO_MEMORY` / `HOSTX_MONGO_CACHE_GB` | `1g` / `0.25` | Mongo container limits |
| `HOSTX_MONGO_ADMIN_URI` | – | Docker ke bina ya apna Mongo server |
| `HOSTX_PUBLIC_SCHEME` / `HOSTX_PUBLIC_PORT` | `http` / proxy port | Dashboard mein dikhne wale URLs ke liye |
| `HOSTX_WEB_ORIGIN` | `http://localhost:3000` | CORS allow-list (comma separated) |
| `HOSTX_SECRET` | auto (`data/secret.key`) | Token signing secret |
| `HOSTX_RUNNER` | `auto` | `auto` \| `docker` \| `process` |
| `HOSTX_MAX_PROJECTS` | `5` | Per-user project limit |
| `HOSTX_POLL_SECONDS` | `60` | Auto-deploy polling interval (`0` = off) |
| `HOSTX_API_PUBLIC_URL` | `http://localhost:4000` | Webhook URL jo dashboard dikhata hai |
| `HOSTX_APP_MEMORY` / `HOSTX_APP_CPUS` | `300m` / `0.5` | Docker limits |

Dashboard: `web/.env.local` mein `NEXT_PUBLIC_API_URL=http://localhost:4000` aur `NEXT_PUBLIC_SITE_URL=http://localhost:3000` (dono build time par bake hote hain).

## API

`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/verify-email|resend-verification|forgot-password|reset-password`
`POST /api/projects/:id/domains` · `POST /api/projects/:id/domains/:name/verify` · `DELETE /api/projects/:id/domains/:name` · `GET /api/domains/check` (Caddy) · `GET /api/billing/plans` · `GET /api/billing` · `POST /api/billing/subscribe|cancel|webhook` · `GET|DELETE /api/github` · `GET /api/github/repos` · `GET /api/auth/github/callback` · `POST /api/github/webhook`
`POST /api/scan` · `GET|POST /api/projects` · `GET|PATCH|DELETE /api/projects/:id`
`POST /api/projects/:id/deploy|stop|start` · `POST /api/projects/:id/deployments/:did/rollback` · `GET /api/projects/:id/events` · `POST|DELETE /api/projects/:id/database` · `GET /api/projects/:id/deployments/:did/logs?after=N` · `GET /api/projects/:id/logs`

Sab (health aur webhook ke alawa) login cookie maangte hain (`credentials: 'include'`).

## Live server pe (production)

Files: `.env.production.example`, `web/.env.example`, `deploy/hostx-engine.service`, `deploy/hostx-web.service`, `deploy/Caddyfile`.

1. **Server**: Linux VPS, Node 20+, git, **Docker Engine** (Process mode production mein start hi nahi hoga — `NODE_ENV=production` + Docker na ho to engine refuse karta hai).
2. **DNS**: `app.yourdomain.com`, `api.yourdomain.com` aur wildcard `*.yourdomain.com` → server IP.
3. `cp .env.production.example .env` aur edit karo: `HOSTX_BASE_DOMAIN`, `HOSTX_SECRET` (lamba random), `HOSTX_PUBLIC_SCHEME=https`, `HOSTX_PUBLIC_PORT=443`, `HOSTX_WEB_ORIGIN=https://app.yourdomain.com`. `web/.env.local`: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` (build se pehle).
4. `npm ci && npm run build` aur `cd web && npm ci && npm run build`.
5. systemd units copy karo (`deploy/*.service`), `systemctl enable --now hostx-engine hostx-web`.
6. **TLS**: Caddy (`deploy/Caddyfile`) — wildcard cert ke liye DNS-01 plugin wala build chahiye. Firewall: sirf 80/443 (+SSH) kholo; 3000/4000/8080 aur 5001-5999 public mat karo.
7. Apne account banao, fir `HOSTX_ALLOW_SIGNUP=false` karke engine restart karo (agar public signup nahi chahiye).

Security jo built-in hai: scrypt passwords, HS256 tokens, login rate-limit (IP + email), owner-only project access, container limits (`--memory/--memory-swap/--cpus/--pids-limit`, `--cap-drop=ALL`, `no-new-privileges`, non-root user), ports sirf `127.0.0.1` pe, API loopback pe (containers usse nahi pahunch sakte), git clone mein symlinks band, dashboard pe CSP/X-Frame-Options headers.

Dhyan do:
- Apps ka code Docker container mein chalta hai, lekin Docker kernel share karta hai. Public/untrusted users ke liye gVisor/Sysbox jaisa extra sandbox sochna.
- `data/db.json` mein env vars plaintext hain (file mode 600). Disk/backup ko secure rakho.
- Backups: `data/` folder (db + secret). `apps/` dobara ban sakta hai.

## Abhi support nahi (next steps)

- Private GitHub repos (OAuth / deploy tokens)
- Custom domains
- Managed MongoDB — abhi `MONGO_URI` env var se Atlas jaisa external DB use karo
- **Docker mode real Docker pe test nahi hua** (is machine pe Docker nahi tha). Fake `docker` shim se build/run/stop/start/recovery ka flow aur command-line args verify hue; asli images/nginx/container limits ek baar Docker wali machine pe check karo (neeche checklist).

## Docker wali machine pe pehli baar verify karo

```bash
HOSTX_RUNNER=docker npm run dev          # engine
# dashboard se ek Vite repo (nginx) aur ek Express repo deploy karo, fir:
docker ps --filter name=hostx-
docker inspect hostx-<id> --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.CapDrop}}'
docker exec hostx-<id> whoami            # node app: "node" (root nahi)
```
