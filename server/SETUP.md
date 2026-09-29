# Ant App — Cloud Server Setup

This turns Ant App into a real online product: customers sign up at
`/pricing`, pay via Stripe, log in at `/login`, and use the app at `/app`
with their data stored in MySQL (not just in one browser) — and the app
itself installs like a native app (PWA) on desktop and mobile.

The server is plain Node.js (`http`, `crypto`, `fetch` — no framework)
with one real dependency, `mysql2`, for talking to MySQL. Everything else
was kept dependency-free deliberately (this was built somewhere `npm
install` wasn't reachable), but MySQL has no Node built-in equivalent the
way SQLite briefly did, and hand-rolling a MySQL wire-protocol client
would be too risky for a financial app's data layer — so `mysql2` (the
standard, well-maintained driver) is a real, worthwhile dependency here.

**Testing note**: I built and unit-tested everything I could reach in the
sandbox this was written in, but that sandbox has no MySQL server and
can't reach npm, so `npm install` and the MySQL connection itself are
untested end-to-end. Run through section 1 below as your first real test.

## 1. Set up MySQL and run it locally (no Stripe needed yet)

1. Install MySQL locally if you don't have it (`brew install mysql` on
   Mac, `apt install mysql-server` on Ubuntu, or use Docker:
   `docker run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=devpass mysql:8`).
2. Create a database: `mysql -u root -p -e "CREATE DATABASE ant_app;"`
   (the app creates its own tables inside it on first boot — no schema
   file to run by hand).
3. Copy `server/.env.example` to `server/.env` and fill in `MYSQL_HOST`,
   `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (or set `MYSQL_URL`
   instead, e.g. `mysql://root:devpass@localhost:3306/ant_app`).
4. Install the one dependency and start the server:
   ```
   cd server
   npm install
   node src/index.js
   ```
   If it can't reach MySQL, it prints the connection error and exits
   immediately rather than starting half-working — check the credentials
   above first.

Open `http://localhost:8787/pricing`. Without Stripe configured, the server
runs in **dev mode**: signing up for any plan activates the account
immediately with no payment, so you can click through the whole product —
signup, the in-app first-run wizard, booking/finance features, logout,
login — before wiring up real billing.

## 2. Create your Stripe account

1. Go to https://dashboard.stripe.com/register and create an account for
   the business. Stripe will ask for business details before you can go
   live, but **test mode works immediately** with no verification — start
   there.
2. In the Stripe Dashboard, switch to **Test mode** (toggle top-right).
3. **Get your API keys**: Developers → API keys. Copy the **Secret key**
   (`sk_test_...`) — this goes in `STRIPE_SECRET_KEY`.
4. **Create the three subscription prices**: Product catalog → Add product,
   once per plan:
   - "Ant App — Front Office", recurring price, $39.00/month
   - "Ant App — Back Office", recurring price, $49.00/month
   - "Ant App — Complete", recurring price, $69.00/month
   (See `claude/editions-and-pricing.md` in the project for the reasoning
   behind these numbers — adjust as you like.) After creating each, open
   the price and copy its ID (`price_...`).
5. **Set up the webhook** (tells your server when a payment succeeds or a
   subscription changes): Developers → Webhooks → Add endpoint.
   - Endpoint URL: `https://YOUR-DOMAIN/api/stripe/webhook`
   - Events to send: `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - After creating it, copy the **Signing secret** (`whsec_...`) —
     this goes in `STRIPE_WEBHOOK_SECRET`.
   - While testing locally without a public URL yet, use the Stripe CLI
     (`stripe listen --forward-to localhost:8787/api/stripe/webhook`)
     instead — it prints a temporary webhook secret to use locally.
6. When ready to take real payments, complete Stripe's business
   verification and switch the dashboard to **Live mode** — then repeat
   steps 3–5 for the live keys/prices/webhook (test and live are
   completely separate) and swap the env vars.

## 3. Environment variables

Copy `server/.env.example` to `server/.env` and fill in:

| Variable | Required | What it's for |
|---|---|---|
| `SESSION_SECRET` | **Yes, before going live** | Signs login sessions. Any long random string — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Without it the server makes up a random one at startup, which logs everyone out on every restart. |
| `APP_URL` | Yes | The public URL customers will use, e.g. `https://app.yourdivesoftware.com`. Used to build Stripe redirect/webhook URLs. |
| `PORT` | No | Defaults to 8787. Most hosts set this for you. |
| `MYSQL_URL` | Yes (or the vars below) | A full connection string, e.g. `mysql://user:pass@host:3306/dbname` — what most managed MySQL hosts (PlanetScale, Railway, RDS, etc.) hand you directly. |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Yes, if not using `MYSQL_URL` | Discrete connection details instead of one URL. Ignored if `MYSQL_URL` is set. |
| `STRIPE_SECRET_KEY` | For real billing | From step 2.3 above. Leave unset to keep running in dev mode. |
| `STRIPE_WEBHOOK_SECRET` | For real billing | From step 2.5 above. |
| `STRIPE_PRICE_FRONT` / `STRIPE_PRICE_BACK` / `STRIPE_PRICE_COMPLETE` | For real billing | The three price IDs from step 2.4. |
| `FORCE_SECURE_COOKIE` | No | Set to `1` if your host terminates HTTPS but doesn't set `X-Forwarded-Proto` (session cookies won't get the `Secure` flag otherwise, which some proxies need). |

## 4. Deploying (once you've picked a host)

This is a plain Node HTTP server with no build step, so it runs almost
anywhere that runs Node 18+: Railway, Render, Fly.io, a DigitalOcean
droplet, your own VPS, etc. You'll additionally need a MySQL database —
either the same host's managed MySQL add-on (Railway, Render, PlanetScale,
AWS RDS, DigitalOcean Managed MySQL all work — any of them give you the
`MYSQL_URL` env var directly) or your own MySQL server reachable from
wherever the app runs. Once you tell me which host you've picked, I'll
write the exact deploy steps (and a Dockerfile if useful) for it.

Start command: `npm install && node server/src/index.js` (from the repo
root, or `npm install && node src/index.js` from inside `server/`).

## 5. Installing as an app (PWA)

The app is installable on desktop and mobile — visiting `/app` in a
supporting browser (Chrome, Edge, Android) shows an install prompt, and
on iOS Safari, "Share → Add to Home Screen" does the same. Once installed
it opens in its own window/icon, with no browser chrome, and the app
shell (not each customer's data) is cached so it still *opens* offline —
see `PWA.md` for exactly what that does and doesn't cover.

## 6. What's still worth doing before a real launch

- **Backups**: set up scheduled MySQL backups (most managed MySQL hosts
  offer automatic snapshots — turn them on).
- **Email**: there's no email sending yet (welcome emails, password
  reset). Worth adding once you're ready — happy to build it once you
  pick a provider (Postmark, Resend, SES, etc. all have plain HTTP APIs
  that don't need an SDK either).
- **Password reset**: not built yet — right now a forgotten password has
  no self-serve recovery. Should come before a public launch.
- **Custom domain**: point your domain at wherever you deploy, and set
  `APP_URL` to match.
- **Connection pool sizing**: `db.js` opens a pool of 10 MySQL
  connections by default (`connectionLimit`) — fine to start, revisit if
  you have many concurrent dive centres.
