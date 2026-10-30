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
| `data/` | Runtime state: `hostx.db` (SQLite: users, projects, deployments…), `backups/`, `secret.key`, logs, static builds (git-ignored) |
| `apps/` | Cloned repos, `apps/<projectId>/src` (git-ignored) |

Engine layers: `routes → controllers → services`
- `auth.service` — scrypt password hash + HS256 token (sirf `node:crypto`)
- `store.service` + `db.service` — SQLite (`node:sqlite`, WAL), row-level transactional writes, in-memory read cache
- `cloner.service` — shallow `git clone` + repo scan (har `package.json` wala folder)
- `detect.service` — Vite / CRA / Next / Express etc. detect karta hai
- `docker.service` / `process.service` — runners (neeche dekho)
- `deploy.service` — clone → detect → build → start pipeline, build queue, restart recovery
- `proxy.service` — Host-header reverse proxy (HTTP + WebSocket) + static file server

## Run (development)

**Node.js 22.13+ zaroori hai** (built-in SQLite). `nvm use` (`.nvmrc` = 22).

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
| **Docker** | Docker engine mile to automatic | Har app apne container mein: `--memory` + `--cpus` (plan ke hisaab se, default 512m / 0.5), `--pids-limit=256`, sirf `127.0.0.1` pe publish |
| **Process** | Docker na ho (dev fallback) | **Koi isolation nahi** — repo ka code seedha aapki machine pe chalta hai |

> Is Mac pe Docker install nahi hai, isliye abhi **Process mode** chal raha hai (navbar mein "Dev mode" chip).
> Sirf apni khud ki repos deploy karo. Dusre users ko allow karne se pehle Docker Desktop install karo — tab mode khud `Docker isolated` ho jayega.
> Zabardasti Docker chahiye to `HOSTX_RUNNER=docker`.

Static sites (Vite/CRA): Docker mode mein nginx container; Process mode mein build ke baad proxy khud files serve karta hai (SPA fallback ke saath).

**Build details:** Node.js version `package.json` ke `engines.node` se (18/20/22/24, default **22**). Lockfile se package manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn (corepack), warna npm.

**Sandboxed builds (Docker):** user ka code (`npm install`, postinstall scripts, build command) kabhi `docker build` ke andar nahi chalta (BuildKit par memory limit lag hi nahi sakti). Wo ek throwaway `docker run` container mein chalta hai: `HOSTX_BUILD_MEMORY` (1g, bina swap), `HOSTX_BUILD_CPUS` (1), max 512 processes, `--cap-drop=ALL`, `no-new-privileges`, non-root user, 10 min timeout (timeout par container bhi hata diya jata hai). Phir `docker build` sirf taiyaar folder COPY karta hai. Memory khatam ho to saaf "ran out of memory" error. Build folder `HOSTX_BUILD_MAX_DISK_MB` (3072) se bada ho to deploy fail, disk nahi bharti. Bonus: env vars ab image history mein build-args ki tarah save nahi hote.

**Zero-downtime deploys (Docker):** har deploy ka apna image tag (`hostx-<id>:<version>`) aur container (`hostx-<id>-<version>`) naye port pe start hota hai. Health check pass hone ke baad hi proxy naye version pe switch karta hai, phir purana container + image delete hota hai (dangling images aur 7 din purana build cache bhi prune). Naya version fail ho to purana chalta rehta hai. Container logs `10m × 3` files tak capped hain.

## Security

**Built in:** scrypt password hashes · **sessions in HttpOnly cookies only** (over https named `__Host-hostx_at` / `__Host-hostx_rt`, so a user's app on a sibling subdomain cannot plant a session cookie; malformed cookies are ignored) (nothing in `localStorage`/JS): 15-min access token + 30-day rotating refresh token, refresh-reuse detection (a replayed old refresh token revokes the whole login), instant server-side logout, CSRF `Origin` check + `SameSite=Lax` · tokens revoked on password change/reset/suspend/delete · login limits per IP *and* per email · global API limit (600 req/min/IP) · deploy limit (30 builds/hour/user) · owner-only project access (same 404 for "missing" and "not yours") · webhook HMAC-SHA256 · env vars & webhook secrets **encrypted at rest** (AES-256-GCM, key derived from `HOSTX_SECRET`) · `data/` is `0700`, files `0600` · server paths hidden from user logs · CSP, HSTS, X-Frame-Options on the dashboard · API on loopback · git clone without symlinks/hooks · one private Docker network per project (users' containers cannot reach each other) with `--cap-drop=ALL`, `no-new-privileges`, memory/CPU/pids/ulimit caps, non-root user · production refuses to start without Docker or with a `HOSTX_SECRET` shorter than 32 chars.

**You must do on the server (cannot be done from code):**

1. **Behind Caddy/nginx set `HOSTX_TRUST_PROXY=true`.** Without it every user shares the proxy's IP in rate limits. Never set it if the API is reachable directly.
2. **Docker network pools.** Every project gets its own Docker network; Docker's default pools allow only ~30. In `/etc/docker/daemon.json` set `{"default-address-pools":[{"base":"10.200.0.0/16","size":24}]}` (256 networks) and restart Docker.
3. **Block what containers must not reach** (user code and builds run there): `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP` (cloud metadata) and drop traffic from Docker bridges to the host's own ports (`iptables -I INPUT -i br+ -j DROP` / `-i docker0`), keeping only what you need.
4. Firewall: only 80/443 (+SSH) public. Keep 3000, 4000, 8080 and 5001-24999 closed. Also set `HOSTX_PROXY_HOST=127.0.0.1` so the app proxy only listens for Caddy/nginx.
5. Run the engine as a dedicated user. Docker group membership is root-equivalent, so protect that account (SSH keys only, no password login).
6. **Back up `data/backups/` + `data/secret.key` off the server** (e.g. nightly rsync / S3). The engine writes a consistent snapshot `data/backups/hostx-YYYY-MM-DD.db` every day and keeps 7 (`HOSTX_BACKUP_DAYS`). Do not change `HOSTX_SECRET` / `secret.key` afterwards: stored env vars become unreadable (they are encrypted with it).
7. Set `HOSTX_ALLOW_SIGNUP=false` once your own accounts exist (open sign-up lets strangers run builds on your CPU).

**Known limits / accepted risks:**

- Docker shares the host kernel. For untrusted public users add gVisor/Sysbox or run HostX on a throwaway VM.
- Auth cookies are `SameSite=Lax`, so the dashboard and the API must share one registrable domain (e.g. `app.example.com` + `api.example.com`). Users' apps live on sibling subdomains, which is why every state-changing request is also checked against the dashboard `Origin`.
- No 2FA yet; admin sees every user's build logs. Legal pages are templates: have them reviewed by a lawyer.
- SQLite database: one engine process per server (the engine also owns Docker and ports on that machine, so this is by design).

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

**Admin kaun banta hai (apne aap sirf ek baar):**
- Database mein jab **ek bhi user aur ek bhi admin na ho**, tab pehla account admin banta hai (email ya GitHub sign-up). Ek saath kai log register karein to bhi sirf ek admin banta hai.
- `HOSTX_ADMIN_EMAIL` wala account bhi admin tabhi banta hai jab platform par **koi admin na ho** (aur email verify ho).
- Ek admin ban gaya to aage koi bhi apne aap admin nahi banta. Naya admin sirf koi admin **Admin → Users** se bana sakta hai.
- **Galat aadmi admin ban gaya / admin ka access kho gaya?** Server par engine band karke: `npm run make-admin -- you@example.com --only` (aapka account admin, baaki sab admins normal users, sabke sessions logout). Ye sirf server ka shell access rakhne wala chala sakta hai. Phir engine start karo.

Admin ko navbar mein **Admin** link dikhta hai:

| Page | Kya kar sakte ho |
|---|---|
| Overview | users/projects/deployments ke counts, 24h failure rate, 7-din ka deployment chart, memory/CPU/ports/disk |
| Users | search, make/remove admin, per-user project limit, suspend/reactivate (apps turant offline), delete user + uske projects |
| Projects | sab users ke projects: status filter, logs (build + runtime), redeploy, stop/start, delete |
| Deployments | latest 100 deployments, failed filter, har ek ka log |
| Settings | **website ka naam**, signups on/off, plans & limits, default project limit (restart ke bina) |
| Audit log | kisne kya kiya (user/project/settings changes) |

**Website ka naam (Admin → Settings → Website name):** admin kabhi bhi naam badal sakta hai (2-40 characters; khaali/Reset = `HostX`). Naya naam logo, landing page, page titles, legal pages, footer, share image, app manifest, emails, build logs (`[naam]`) aur paused/archived app pages par dikhta hai. Save karte hi khuli hui pages aur server pages turant update hote hain; baaki jagah max 1 minute (cache). Dashboard server engine se naam leta hai; dono alag machine par hon to `HOSTX_INTERNAL_API_URL` set karo.

Safeguards: apne aap ko demote/suspend/delete nahi kar sakte, kam se kam ek active admin hamesha rehta hai, admin list mein env values/secrets nahi dikhte, aur har admin action audit log mein jata hai.

## Theme

Default **Daylight Aurora** (light: lavender-white, indigo → pink gradient). Navbar ke sun/moon button se **Midnight Indigo** (dark) — choice browser mein save rehti hai. Saare colors `web/app/globals.css` ke top ke tokens mein hain.

## Domains: dashboard aur apps alag rakho

Render ki tarah (`render.com` vs `onrender.com`) do domains use karo:

| Domain | Kya chalta hai |
|---|---|
| `app.yourdomain.com`, `api.yourdomain.com` | Dashboard + API (aapka trusted code) |
| `<slug>.yourapps.app` | Users ki apps (`HOSTX_BASE_DOMAIN=yourapps.app`) |

**Project URL kaise banta hai:** project ka naam → slug → `https://<slug>.<apps domain>` (jaise Render par `name.onrender.com`). Naam pehle se liya ho to 4-character suffix lagta hai (`shop-x7k2`). URL save nahi hota, har baar apps domain se banta hai, isliye domain badalte hi saare projects ke URL apne aap naye domain par aa jaate hain. Admin → Settings → **App URLs** mein abhi ka pattern dikhta hai.

**`HOSTX_BASE_DOMAIN` set nahi kiya?** Production mein engine apne aap dashboard ke domain se apps domain bana leta hai: dashboard `app.deploykaro.com` → apps `<slug>.apps.deploykaro.com` (DNS: `*.apps.deploykaro.com` → server IP, Caddy mein bhi wahi). Ye chal jaata hai (login cookies `__Host-` hain aur har request ka Origin check hota hai), lekin sabse safe Render jaisa alag domain hi hai. Local par hamesha `http://<slug>.localhost:8080`.

Kyun: same registrable domain par user ki app dashboard ke liye cookies set kar sakti hai, aur ek phishing app aapka poora main domain Google Safe Browsing / spam lists mein block karwa sakti hai. Production mein agar `HOSTX_BASE_DOMAIN` khud dashboard wale domain par set karo to engine start nahi hota (`HOSTX_ALLOW_SHARED_DOMAIN=true` se override). `yourapps.app` aur `www.yourapps.app` dashboard par redirect hote hain. Live hone ke baad apps domain ko <https://publicsuffix.org> par submit karo (browsers phir har app ko alag site maanenge). Caddy config: `deploy/Caddyfile`.

## MongoDB (Atlas)

HostX **database host nahi karta**. Users apna free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) database lagate hain, aur uska connection string project ke Environment mein `MONGODB_URI` (ya `MONGO_URI`) ke roop mein daalte hain.

- **Kyun:** MongoDB Server SSPL license par hai, jo MongoDB ko doosron ko "service" ki tarah dene par poore platform ka source code kholne ki shart rakhta hai. Atlas se ye risk nahi hai, data ka backup aur security MongoDB ke paas hai, aur aapke server ki RAM/disk bachti hai.
- Project → **Database** tab mein step-by-step guide hai: free M0 cluster, database user, Network Access, connection string, phir "Open Environment and add MONGODB_URI". Tab batata hai ki URI set hai ya nahi.
- **`HOSTX_PUBLIC_IP` set karo:** guide user ko yahi IP Atlas ke Network Access mein allow karne ko kehti hai (apps isi IP se Atlas tak jaati hain). Set na ho to guide `0.0.0.0/0` batati hai.
- Env vars encrypted at rest rehte hain. Static site ke env mein Mongo URI ho to build log mein warning aati hai (frontend code mein wo public ho jata).

## Email (verification + forgot password)

- Sign-up par confirmation link jata hai (24 ghante valid). Unverified account login kar sakta hai lekin **deploy nahi** (dashboard mein "Resend email" banner). Pehla account (owner) aur admins kabhi block nahi hote; purane accounts verified maane jaate hain.
- Login page → **Forgot password?** → email link (1 ghanta, ek baar). Reset ke baad saare devices sign-out. Unknown email par bhi wahi jawab, taaki koi emails check na kar sake.
- Emails par rate limit: 3/ghanta per account.
- Koi bhi SMTP provider (Brevo, Amazon SES, Resend, Postmark, Mailgun, Gmail app password):
  `HOSTX_SMTP_URL=smtps://user:pass@smtp.provider.com:465` (ya `smtp://...:587` STARTTLS; bina TLS ke sirf localhost par). User/pass mein `@` ho to `%40` likho. `HOSTX_MAIL_FROM="HostX <no-reply@yourdomain.com>"`.
- SMTP set hote hi verification zaroori ho jata hai (`HOSTX_REQUIRE_VERIFIED_EMAIL=true|false` se badlo). Development mein SMTP na ho to email engine log mein print hota hai.
- Domain par SPF/DKIM/DMARC records lagao (provider batata hai), warna mails spam mein jayenge.


## GitHub App (private repos + instant deploys)

Users "Connect GitHub" karke apni private repos deploy kar sakte hain. HostX sirf wahi repos padh sakta hai jo user GitHub par chunta hai, aur har clone ek 1-ghante ke installation token se hota hai (token clone URL, `.git/config`, logs ya `ps` mein kabhi nahi dikhta). Ek hi webhook se saari connected repos par push → deploy.

**Setup (ek baar):** GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**
- Homepage URL: `https://app.yourdomain.com`
- Callback URL: `https://api.yourdomain.com/api/auth/github/callback` ✅ **"Request user authorization (OAuth) during installation"** on
- Setup URL: khali chhodo · Webhook URL: `https://api.yourdomain.com/api/github/webhook`, ek random webhook secret
- Permissions → Repository: **Contents: Read-only**, Metadata: Read-only. Events: **Push**
- "Any account" par installable rakho (public SaaS ke liye)
- Banne ke baad private key (.pem) download karo

- Permissions → Account: **Email addresses: Read-only** ("Continue with GitHub" ko verified email chahiye)

**Continue with GitHub (login/sign-up):** login aur register page par button. Pehli baar: account ban jata hai (GitHub ka verified email, email verification nahi chahiye), aur user seedha **New deploy** par jata hai jahan uski repos dikhti hain. Usi email ka account pehle se ho to wahi jud jata hai. Login-CSRF se bachne ke liye ek short-lived nonce cookie GitHub round-trip ko usi browser se bandhti hai. Signups band hon to naye GitHub users ka account nahi banta. GitHub se bane account mein password nahi hota ("Forgot password" se set kar sakte hain).

**New deploy (Render jaisa):** 1) Web Service ya Static Site chuno → 2) apni repos mein search karo (ya public URL paste karo), "Connect" → 3) settings auto-detect, chune gaye type se match karta folder pehle chuna jata hai; folder doosre type ka nikle to "Deploy as …" ka sujhav. Auto-deploy default on: GitHub App wali repos par push hote hi (webhook), baaki par ~1 min mein (polling).

Engine env: `HOSTX_GITHUB_APP_ID`, `HOSTX_GITHUB_APP_SLUG` (URL wala naam), `HOSTX_GITHUB_CLIENT_ID`, `HOSTX_GITHUB_CLIENT_SECRET`, `HOSTX_GITHUB_WEBHOOK_SECRET`, aur `HOSTX_GITHUB_PRIVATE_KEY_FILE=/opt/hostx/github-app.pem` (ya poori PEM `HOSTX_GITHUB_PRIVATE_KEY` mein, `\n` ke saath). git >= 2.31 chahiye.

Security: callback par installation id par bharosa nahi kiya jata. OAuth code se GitHub se poocha jata hai ki is GitHub user ko kaunsi installations dikhti hain, aur signed `state` usi HostX user ka hona chahiye jo signed-in hai. Public repos bina connect kiye pehle jaisi chalti hain.

## Admin notifications

Admin panel → **Notifications** (sidebar mein unread count). Saare admins ko email bhi jata hai (SMTP set ho to; ek project ke liye ghante mein max 1 email, in-app list mein sab kuch).

| Alert | Kab |
|---|---|
| **Deploy failed** | Kisi bhi user ka koi bhi deploy fail ho (owner email, kaunsa deploy, error ki pehli line, app abhi live hai ya offline) |
| **Disk almost full** | Server disk jahan databases, backups aur builds rehte hain (`data/` aur Docker data root) 85% / 95% bhar jaye (`HOSTX_DISK_WARN_PERCENT`, `HOSTX_DISK_CRITICAL_PERCENT`) |
| **Memory high** | Server RAM 85% / 95% use par, lagatar 3 minute tak (build ka chhota spike alert nahi deta). Sirf Linux par (`/proc/meminfo`), kyunki macOS cache ko "used" ginta hai. `HOSTX_MEMORY_WARN_PERCENT`, `HOSTX_MEMORY_CRITICAL_PERCENT` |
| **Capacity limit** | App ports (5001-24999) ya Docker app networks 80% / 95% bhar jaayein (`HOSTX_NETWORK_CAPACITY`, default 250, README ke address pool ke hisaab se). Docker network banana fail ho to turant critical alert |

Disk, ports aur networks har 10 min, RAM har minute check hote hain ("Check now" button bhi). Wahi level 24 ghante mein ek baar hi dobara aata hai; warning se critical par turant. Page par **Server capacity** card: har disk, RAM, ports, Docker networks aur live apps ki ginti.

## Crash monitor + alerts

Har 30 second engine har chalti app check karta hai:
- **Docker:** container crash hone par Docker use khud restart karta hai (`unless-stopped`); HostX ise pakad kar project ki **Recent activity** (Runtime logs tab) mein likhta hai: exit code, ya "out of memory". Container band hi rahe to status **Crashed**, proxy saaf "This app crashed" page dikhata hai, aur wapas chalne par apne aap **Live** + "recovered".
- **Process mode (dev):** HostX khud restart karta hai (10 min mein max 3 baar), phir Crashed.
- Owner ko email: crash par, aur **auto-deploy fail** hone par (har app ke liye ghante mein max 1 email per type). SMTP chahiye.
- Crashed app par **Restart** button; redeploy ya rollback bhi kar sakte ho.

## One-click rollback

Har successful Docker deploy ki image rakhi jati hai (latest 3, `limits.rollbackImages`). Deployments tab mein purana version chuno → **Roll back to this version**: wahi image naye container mein start hoti hai (koi clone/build nahi, kuch second), health check ke baad traffic switch, purana version hata diya jata hai. Current env vars use hote hain. "Serving" tag batata hai abhi kaunsa deployment live hai.

Rollback ke baad auto-deploy use turant undo nahi karta: polling "aakhri dekhe gaye commit" se compare karta hai, isliye agla deploy **naye push** par hi hoga. Process mode mein rollback nahi hai (wahan images nahi bantin).

## Database (SQLite)

Control-plane data (users, projects, deployments, sessions, tokens, events, audit log, settings) `data/hostx.db` mein, Node ke built-in `node:sqlite` se: koi naya package ya database server nahi.

- **WAL mode:** crash ya power cut mein bhi file corrupt nahi hoti; har write ek chhota transaction hai (pehle har change par poori JSON file dobara likhi jaati thi).
- **Integrity:** email, project slug aur session token par UNIQUE constraints (do sign-ups ek saath race karein to bhi duplicate nahi).
- Har record `doc` (JSON) column mein + indexed columns. Naya field jodne ke liye migration nahi chahiye; schema versions `PRAGMA user_version` se (`src/services/db.service.ts` mein `MIGRATIONS`).
- Secrets (env vars, webhook secret, database passwords) ab bhi AES-256-GCM se encrypted.
- **Purane install:** pehli baar start par `data/db.json` apne aap SQLite mein import hota hai (ek transaction), aur file `db.json.migrated-<date>` naam se backup ke roop mein rehti hai. Sessions bhi migrate hote hain, koi logout nahi.
- **Backups:** roz `data/backups/hostx-YYYY-MM-DD.db` (`VACUUM INTO`, chalte engine par safe), last 7 rakhe jaate hain. Restore: engine band karo, backup file ko `data/hostx.db` par copy karo (`-wal`/`-shm` hata do), start karo.
- Inspect: `sqlite3 data/hostx.db "select id, email from users"`.

## Legal pages (launch + Razorpay activation)

Public pages: `/terms`, `/privacy`, `/acceptable-use`, `/refund-policy`, `/shipping-policy`, `/contact` (footer + sitemap mein). Razorpay website review inhi 5 cheezon ko check karta hai: Terms, Privacy, Cancellation & Refund, Shipping/Delivery, Contact Us.

Business details dashboard build ke time env se aate hain (`web/.env.local`). Jo set nahi hai wo page par `[placeholder]` dikhta hai, taaki galti se live na jaye:
`NEXT_PUBLIC_LEGAL_COMPANY`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_LEGAL_EMAIL`, `NEXT_PUBLIC_LEGAL_PHONE`, `NEXT_PUBLIC_LEGAL_ABUSE_EMAIL`, `NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER`, `NEXT_PUBLIC_LEGAL_GRIEVANCE_EMAIL`, `NEXT_PUBLIC_LEGAL_JURISDICTION`, `NEXT_PUBLIC_LEGAL_UPDATED`.

- Content India ke hisaab se: DPDP Act 2023, IT Act 2000, IT Rules 2021 (Grievance Officer), aur product ka asli behaviour (kaunsa data, kahan, kitne din). **Ye template hai, legal advice nahi. Launch se pehle kisi lawyer se review karwao.**
- Sign-up par "I agree" checkbox zaroori; engine `termsAcceptedAt` + `termsVersion` (`HOSTX_TERMS_VERSION`) save karta hai.
- **Account → Delete account** (password + "DELETE"): subscription turant cancel, phir saare apps, databases, domains, logs, sessions delete. Admin wala user-delete bhi yahi use karta hai (pehle paid user delete hone par Razorpay charge karta rehta tha).

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

| Plan | Price | Web Services | Static Sites | RAM / CPU per app | Custom domains | Rollback images | Inactive apps |
|---|---|---|---|---|---|---|---|
| Free | ₹0 | 5 | 10 | 512 MB / 0.5 | 1 | 1 | 7 din bina visit → Paused, 90 din → Archived |
| Starter | ₹299/mo | 15 | 50 | 1 GB / 1 | 3 | 3 | Kabhi nahi |
| Pro | ₹999/mo | 50 | 150 | 2 GB / 2 | 10 | 3 | Kabhi nahi |

**Admin se plans badlo (Admin → Settings → Plans & limits):** Free / Starter / Pro ke Web Services, Static Sites, custom domains, RAM/CPU per app, pause/archive ke din, rollback versions, naam, dikhne wali price aur Razorpay plan id — sab dashboard se, bina server restart. Badlaav turant Pricing/Billing page aur sabhi users par lagu hote hain; RAM/CPU badalne par chal rahe containers bhi turant resize hote hain. Limit ghatane par kuch delete nahi hota (user bas naye nahi bana sakta). Har badlaav Audit log mein jata hai, aur "Reset to defaults" se `.env` wali values wapas. **Asli charge badalna ho to:** Razorpay mein nayi plan banao aur uska `plan_...` id yahan daalo; purane subscribers apne purane plan id par bill hote rehte hain aur unka HostX plan sahi map hota hai.

**Inactive free apps (sleep mode nahi):** jis app par visits aa rahi hain wo hamesha chalti hai, koi 15-min sleep ya cold start nahi. Proxy har visit note karta hai (har 10 min database mein save).
- **7 din tak ek bhi visit nahi → Paused:** container band (RAM khaali), owner ko email. Image, env vars, domain, URL, history sab bache rehte hain. Visitors ko "paused" page dikhta hai; app **sirf owner ke Resume button** se wapas chalti hai (visit se apne aap nahi). Resume / naya deploy / push par auto-deploy = naya 7-din period.
- **83 din → email** ("7 din baad archive hogi"), **90 din → Archived:** Docker image aur build output delete (disk khaali). Project, settings, env vars, domains aur subdomain hamesha rehte hain; **Redeploy** GitHub se dobara build karta hai (1–3 min). Project tab tak delete nahi hota jab tak user khud na kare.
- **Archived app wapas kaise milega:** project page par **Restore** button. Wo GitHub se wahi repo/branch dobara build karta hai (env vars, domains, URL wahi). Repo rename/move hui ho to pehle **Settings → Repository** mein naya URL/branch daalo; repo delete ho gayi ho to Restore saaf error deta hai ki kya karna hai. Isliye users ko apni repo GitHub par rakhni chahiye (HostX archive ke baad code ki copy nahi rakhta).
- **Static sites** kabhi pause/archive nahi hoti (unka koi server process nahi, kharcha na ke barabar). Archive sirf band padi app (paused/stopped/failed) ki hoti hai, aur hamesha warning email ke kam se kam 7 din baad.
- Paid plans aur admins par ye kabhi lagu nahi. Settings: `HOSTX_FREE_PAUSE_DAYS`, `HOSTX_FREE_ARCHIVE_DAYS`, `HOSTX_FREE_WEB_SERVICES`, `HOSTX_FREE_STATIC_SITES` (aur `HOSTX_STARTER_*` / `HOSTX_PRO_*`).

Har plan par apps **hamesha chalu** rehti hain: koi sleeping mode nahi (Render ke free tier ki tarah 15 min baad band nahi hoti). Free apps bhi 24 ghante server ki RAM leti hain, isliye server ka size users ke hisaab se rakho (`Free projects × 512 MB`).

Sab env se badal sakte ho (`HOSTX_PRICE_STARTER`, `HOSTX_FREE_WEB_SERVICES`, `HOSTX_PRO_MEMORY`, `HOSTX_STARTER_CPUS` ...; dekho `src/config/plans.ts`). **Billing tabhi on hoti hai jab Razorpay keys set hon.** Bina keys ke purana behaviour (HOSTX_MAX_PROJECTS, HOSTX_APP_MEMORY) waisa hi rehta hai. Admins par plan limits nahi lagti.

- User **Billing** page → Upgrade → Razorpay ka hosted payment page (UPI autopay, card, netbanking). Plan sirf **signed webhook** aane par badalta hai (browser par bharosa nahi). Duplicate webhooks ignore hote hain.
- Paid plans ke beech switch: same subscription update hota hai (Razorpay prorate karta hai). Cancel: paid period khatam hone tak plan rehta hai, phir Free.
- Renewal fail: Razorpay retry karta hai, tab tak plan rehta hai. Halted/cancelled → Free.
- Plan badalte hi chal rahe containers ki RAM/CPU **bina restart** ke badal jaati hai (`docker update`). Downgrade par purane extra projects delete nahi hote, bas naye nahi ban sakte.
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
| `HOSTX_PUBLIC_SCHEME` / `HOSTX_PUBLIC_PORT` | `http` / proxy port | Dashboard mein dikhne wale URLs ke liye |
| `HOSTX_WEB_ORIGIN` | `http://localhost:3000` | CORS allow-list (comma separated) |
| `HOSTX_SECRET` | auto (`data/secret.key`) | Token signing secret |
| `HOSTX_RUNNER` | `auto` | `auto` \| `docker` \| `process` |
| `HOSTX_MAX_PROJECTS` | `5` | Per-user project limit |
| `HOSTX_POLL_SECONDS` | `60` | Auto-deploy polling interval (`0` = off) |
| `HOSTX_API_PUBLIC_URL` | `http://localhost:4000` | Webhook URL jo dashboard dikhata hai |
| `HOSTX_APP_MEMORY` / `HOSTX_APP_CPUS` | `512m` / `0.5` | Docker limits (billing off) |
| `HOSTX_BUILD_MEMORY` / `HOSTX_BUILD_CPUS` | `1g` / `1` | Har build sandbox ki limit (`HOSTX_MAX_BUILDS`=2 ek saath) |
| `HOSTX_BUILD_MAX_DISK_MB` | `3072` | Build folder ka max size |

Dashboard: `web/.env.local` mein `NEXT_PUBLIC_API_URL=http://localhost:4000` aur `NEXT_PUBLIC_SITE_URL=http://localhost:3000` (dono build time par bake hote hain).

## API

`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/verify-email|resend-verification|forgot-password|reset-password`
`POST /api/projects/:id/domains` · `POST /api/projects/:id/domains/:name/verify` · `DELETE /api/projects/:id/domains/:name` · `GET /api/domains/check` (Caddy) · `GET /api/billing/plans` · `GET /api/billing` · `POST /api/billing/subscribe|cancel|webhook` · `GET|DELETE /api/github` · `GET /api/github/repos` · `GET /api/auth/github/callback` · `POST /api/github/webhook`
`POST /api/scan` · `GET|POST /api/projects` · `GET|PATCH|DELETE /api/projects/:id`
`POST /api/projects/:id/deploy|stop|start` · `POST /api/projects/:id/deployments/:did/rollback` · `GET /api/projects/:id/events` · `POST|DELETE /api/projects/:id/database` · `GET /api/projects/:id/deployments/:did/logs?after=N` · `GET /api/projects/:id/logs`

Sab (health aur webhook ke alawa) login cookie maangte hain (`credentials: 'include'`).

## Live server pe (production)

Files: `.env.production.example`, `web/.env.example`, `deploy/hostx-engine.service`, `deploy/hostx-web.service`, `deploy/Caddyfile`.

1. **Server**: Linux VPS, **Node 22.13+**, git, **Docker Engine** (Process mode production mein start hi nahi hoga — `NODE_ENV=production` + Docker na ho to engine refuse karta hai).
2. **DNS**: `app.yourdomain.com`, `api.yourdomain.com`, aur apps domain `yourapps.app` + wildcard `*.yourapps.app` → server IP.
3. **Kaunse secrets chahiye:** [`.env.template`](.env.template) (engine) aur [`web/.env.template`](web/.env.template) (dashboard) mein har zaroori naam likha hai, values khaali. `cp .env.template .env` aur `cp web/.env.template web/.env.local` karke `=` ke aage apni values likho (khaali chhodi line = default). Ya agar aapke paas `.env.server` aur `web/.env.server` hain (gitignored, sirf aapki machine par) to unhe server par `.env` aur `web/.env.local` naam se rakho aur har `FILL_ME` bharo; jab tak koi `FILL_ME` bacha hai, production engine start nahi hota. Warna `cp .env.production.example .env` aur edit karo: `HOSTX_BASE_DOMAIN`, `HOSTX_SECRET` (lamba random), `HOSTX_PUBLIC_SCHEME=https`, `HOSTX_PUBLIC_PORT=443`, `HOSTX_WEB_ORIGIN=https://app.yourdomain.com`. `web/.env.local`: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` (build se pehle).
4. `npm ci && npm run build` aur `cd web && npm ci && npm run build`.
5. systemd units copy karo (`deploy/*.service`), `systemctl enable --now hostx-engine hostx-web`.
6. **TLS**: Caddy (`deploy/Caddyfile`) — wildcard cert ke liye DNS-01 plugin wala build chahiye. Firewall: sirf 80/443 (+SSH) kholo; 3000/4000/8080 aur 5001-24999 public mat karo.
7. Apne account banao, fir `HOSTX_ALLOW_SIGNUP=false` karke engine restart karo (agar public signup nahi chahiye).

Security jo built-in hai: scrypt passwords, HS256 tokens, login rate-limit (IP + email), owner-only project access, container limits (`--memory/--memory-swap/--cpus/--pids-limit`, `--cap-drop=ALL`, `no-new-privileges`, non-root user), ports sirf `127.0.0.1` pe, API loopback pe (containers usse nahi pahunch sakte), git clone mein symlinks band, dashboard pe CSP/X-Frame-Options headers.

Dhyan do:
- Apps ka code Docker container mein chalta hai, lekin Docker kernel share karta hai. Public/untrusted users ke liye gVisor/Sysbox jaisa extra sandbox sochna.
- Env vars `data/hostx.db` (SQLite) mein AES-256-GCM se encrypted hain (file mode 600). Disk/backup ko phir bhi secure rakho.
- Backups: `data/backups/` + `data/secret.key`. `apps/` dobara ban sakta hai.

## Abhi support nahi (next steps)

- Managed database hosting (jaan-boojh kar nahi: users MongoDB Atlas use karte hain, upar dekho)
- **Docker mode real Docker pe test nahi hua** (is machine pe Docker nahi tha). Fake `docker` shim se build/run/stop/start/recovery ka flow aur command-line args verify hue; asli images/nginx/container limits ek baar Docker wali machine pe check karo (neeche checklist).

## Docker wali machine pe pehli baar verify karo

```bash
HOSTX_RUNNER=docker npm run dev          # engine
# dashboard se ek Vite repo (nginx) aur ek Express repo deploy karo, fir:
docker ps --filter name=hostx-
docker inspect hostx-<id> --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.CapDrop}}'
docker exec hostx-<id> whoami            # node app: "node" (root nahi)
```
