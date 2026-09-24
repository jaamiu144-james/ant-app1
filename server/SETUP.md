# Ant App — Cloud Server Setup

This turns Ant App into a real online product: customers sign up at
`/pricing`, pay via Stripe, log in at `/login`, and use the app at `/app`
with their data stored on the server (not just in one browser). It's a
plain Node.js server with **zero npm dependencies** — everything runs on
Node 22's built-ins (`node:sqlite` for storage, `crypto` for passwords and
sessions, `fetch` for talking to Stripe). `npm install` isn't even
required. That was a deliberate choice (this was built somewhere `npm
install` wasn't reachable) but it's also just fewer moving parts to break.

## 1. Run it locally first (no Stripe needed yet)

```
cd server
node src/index.js
```

Open `http://localhost:8787/pricing`. Without Stripe configured, the server
runs in **dev mode**: signing up for any plan activates the account
immediately with no payment, so you can click through the whole product —
signup, the in-app first-run wizard, booking/finance features, logout,
login — before wiring up real billing. Data is saved to
`server/data/ant-app.sqlite` (gitignore this — it's real customer data
once you go live).

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
| `DB_PATH` | Recommended | Where the SQLite file lives, e.g. `/data/ant-app.sqlite`. Point this at a **persistent disk/volume** — see the hosting note below. |
| `STRIPE_SECRET_KEY` | For real billing | From step 2.3 above. Leave unset to keep running in dev mode. |
| `STRIPE_WEBHOOK_SECRET` | For real billing | From step 2.5 above. |
| `STRIPE_PRICE_FRONT` / `STRIPE_PRICE_BACK` / `STRIPE_PRICE_COMPLETE` | For real billing | The three price IDs from step 2.4. |
| `FORCE_SECURE_COOKIE` | No | Set to `1` if your host terminates HTTPS but doesn't set `X-Forwarded-Proto` (session cookies won't get the `Secure` flag otherwise, which some proxies need). |

## 4. Deploying (once you've picked a host)

This is a plain Node HTTP server with no build step and no external
services except Stripe, so it fits almost anywhere that runs Node 22+:
Railway, Render, Fly.io, a DigitalOcean droplet, your own VPS, etc.

The one thing that matters: **`DB_PATH` needs to point at storage that
survives a redeploy** (a persistent volume/disk), since that SQLite file
*is* every customer's business data. Platforms that give you an ephemeral
filesystem by default (Railway, Render) need you to attach a volume — check
their docs for "persistent volume" or "disk". Once you tell me which host
you've picked, I'll write the exact deploy steps (and a Dockerfile if
useful) for it.

Start command either way: `node server/src/index.js` (from the repo root,
or `node src/index.js` from inside `server/`).

## 5. What's still worth doing before a real launch

- **Backups**: the SQLite file is the entire business's data for every
  customer — set up a scheduled copy of it somewhere else (most hosts with
  persistent volumes also offer snapshotting).
- **Email**: there's no email sending yet (welcome emails, password
  reset). Worth adding once you're ready — happy to build it once you
  pick a provider (Postmark, Resend, SES, etc. all have plain HTTP APIs
  that don't need an SDK either).
- **Password reset**: not built yet — right now a forgotten password has
  no self-serve recovery. Should come before a public launch.
- **Custom domain**: point your domain at wherever you deploy, and set
  `APP_URL` to match.
