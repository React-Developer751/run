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

## Security

**Built in:** scrypt password hashes · **sessions in HttpOnly cookies only** (nothing in `localStorage`/JS): 15-min access token + 30-day rotating refresh token, refresh-reuse detection (a replayed old refresh token revokes the whole login), instant server-side logout, CSRF `Origin` check + `SameSite=Lax` · tokens revoked on password change/reset/suspend/delete · login limits per IP *and* per email · global API limit (600 req/min/IP) · deploy limit (30 builds/hour/user) · owner-only project access (same 404 for "missing" and "not yours") · webhook HMAC-SHA256 · env vars & webhook secrets **encrypted at rest** (AES-256-GCM, key derived from `HOSTX_SECRET`) · `data/` is `0700`, files `0600` · server paths hidden from user logs · CSP, HSTS, X-Frame-Options on the dashboard · API on loopback · git clone without symlinks/hooks · one private Docker network per project (users' containers cannot reach each other) with `--cap-drop=ALL`, `no-new-privileges`, memory/CPU/pids/ulimit caps, non-root user · production refuses to start without Docker or with a `HOSTX_SECRET` shorter than 32 chars.

**You must do on the server (cannot be done from code):**

1. **Behind Caddy/nginx set `HOSTX_TRUST_PROXY=true`.** Without it every user shares the proxy's IP in rate limits. Never set it if the API is reachable directly.
2. **Block the cloud metadata endpoint from containers** (otherwise a user's app can steal your VPS credentials): `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP`.
3. Firewall: only 80/443 (+SSH) public. Keep 3000, 4000, 8080 and 5001-5999 closed.
4. Run the engine as a dedicated user. Docker group membership is root-equivalent, so protect that account (SSH keys only, no password login).
5. **Back up `data/` (db.json + secret.key) together.** Do not change `HOSTX_SECRET` / `secret.key` afterwards: stored env vars become unreadable (they are encrypted with it).
6. Set `HOSTX_ALLOW_SIGNUP=false` once your own accounts exist (open sign-up lets strangers run builds on your CPU).

**Known limits / accepted risks:**

- Docker shares the host kernel. For untrusted public users add gVisor/Sysbox or run HostX on a throwaway VM.
- `docker build` (npm install of user code) is not memory-capped; it has a 10-minute timeout. On a small VPS keep signups closed.
- Auth cookies are `SameSite=Lax`, so the dashboard and the API must share one registrable domain (e.g. `app.example.com` + `api.example.com`). Users' apps live on sibling subdomains, which is why every state-changing request is also checked against the dashboard `Origin`.
- No email verification, 2FA or CAPTCHA; admin sees every user's build logs.
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
| `HOSTX_BASE_DOMAIN` | `localhost` | Apps `<slug>.<domain>` pe |
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

`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
`POST /api/scan` · `GET|POST /api/projects` · `GET|PATCH|DELETE /api/projects/:id`
`POST /api/projects/:id/deploy|stop|start` · `GET /api/projects/:id/deployments/:did/logs?after=N` · `GET /api/projects/:id/logs`

Sab (health ke alawa) `Authorization: Bearer <token>` maangte hain.

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
