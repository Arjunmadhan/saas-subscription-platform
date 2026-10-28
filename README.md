# AI-Enabled SaaS Subscription & Analytics Platform

A mini-SaaS backend that automates subscriptions, generates and delivers invoices, sends renewal reminders through a Redis-backed queue, caches platform metrics in Redis, and lets an AI assistant (Claude Desktop) query live platform statistics through the **Model Context Protocol (MCP)**.

Everything runs locally and uses free tiers only (Stripe Test Mode, Mailtrap/Ethereal, Docker). Total cost: ₹0.

---

## Requirements Coverage

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | Subscription checkout and webhook handling | Stripe Checkout (subscription mode, Test Mode), signed webhook at `POST /api/webhook`, user and subscription upserted in PostgreSQL via Prisma |
| 2 | Automated invoicing and document delivery | PDF invoice generated with PDFKit, stored on local disk, confirmation email (subscription details, PDF attached, download link) sent through Mailtrap/Ethereal |
| 3 | Subscription lifecycle and performance tuning | `node-cron` finds expiring subscriptions, BullMQ (Redis) queue sends reminder emails in the background, Redis cache serves platform metrics |
| 4 | AI agent interface (MCP) | Stdio MCP server exposing read-only tools for active subscribers, revenue and expiring subscriptions |

---

## Architecture

```
Browser ──► POST /api/checkout ──► Stripe Checkout (test card)
                                        │ payment succeeds
                                        ▼
                         POST /api/webhook (signature verified)
                                        │
                  PostgreSQL: upsert user + subscription, create invoice record
                                        │
                  Generate PDF ──► ./invoices   Send confirmation email (Mailtrap/Ethereal)
                                        │
                              invalidate Redis metrics cache

node-cron (scheduled) ──► finds active subscriptions ending soon (PostgreSQL)
                                        │ one job per subscription
                                        ▼
                         Redis ◄── BullMQ queue "renewal-reminders"
                                        │
                         Worker: send reminder email, then set reminderSentAt

GET /api/metrics ──► Redis cache (60s TTL) ──miss──► PostgreSQL

Claude Desktop ◄──stdio──► MCP server ──► same metrics service (Redis cache + PostgreSQL)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Database | PostgreSQL 16 (Prisma ORM) |
| Cache and queue | Redis 7, BullMQ, ioredis |
| Scheduler | node-cron |
| Payments | Stripe (Test Mode) |
| Email | Nodemailer with Mailtrap (or Ethereal as an automatic fallback) |
| PDF | PDFKit |
| AI interface | Model Context Protocol SDK (`@modelcontextprotocol/sdk`), stdio transport |
| Infrastructure | Docker Compose (PostgreSQL and Redis) |

---

## Project Structure

```
saas-subscription-platform/
├── prisma/
│   ├── schema.prisma             # User, Subscription, Invoice models
│   └── migrations/
├── src/
│   ├── index.ts                  # Express server; starts the email worker and the cron
│   ├── config/
│   │   ├── prisma.ts             # Prisma client
│   │   └── mailer.ts             # Nodemailer transporter (Mailtrap, or Ethereal fallback)
│   ├── routes/
│   │   ├── checkout.ts           # Stripe checkout session + webhook + payment processing
│   │   ├── invoices.ts           # Invoice PDF download
│   │   └── metrics.ts            # GET /api/metrics
│   ├── services/
│   │   ├── invoice.ts            # PDF generation and storage
│   │   ├── email.ts              # Confirmation email
│   │   └── metrics.service.ts    # Metrics with Redis cache-aside
│   ├── jobs/
│   │   ├── queue.ts              # Redis connection and BullMQ queue
│   │   ├── renewalCron.ts        # Cron: finds expiring subscriptions, enqueues jobs
│   │   └── emailWorker.ts        # Worker: sends renewal reminder emails
│   ├── mcp/
│   │   ├── bootstrap.ts          # Keeps stdout clean and loads .env (imported first)
│   │   └── server.ts             # MCP server and tools
│   └── utils/logger.ts
├── public/                       # Checkout UI (index, success, cancel pages)
├── invoices/                     # Generated PDFs (auto-created, git-ignored)
├── docker-compose.yml            # PostgreSQL + Redis
├── .env.example
├── tsconfig.json
└── package.json
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- A free [Stripe](https://dashboard.stripe.com/register) account, used in **Test mode** only (no activation needed)
- The [Stripe CLI](https://docs.stripe.com/stripe-cli) (free), to forward webhooks to localhost
- A free [Mailtrap](https://mailtrap.io/) account (optional: leave `SMTP_HOST` empty to use an auto-created Ethereal inbox instead)
- [Claude Desktop](https://claude.ai/download) (only for the MCP demo; the MCP Inspector can be used without it)

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd saas-subscription-platform
npm install
```

### 2. Create the environment file

```bash
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```

Fill in `.env`:

```ini
PORT=3000
BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/saas
REDIS_URL=redis://localhost:6379

# Stripe (Test Mode)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
PRICE_100=price_xxxxxxxxxxxx
PRICE_500=price_xxxxxxxxxxxx
PRICE_1000=price_xxxxxxxxxxxx

# Email: Mailtrap Email Testing (leave SMTP_HOST empty to use Ethereal automatically)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_password
MAIL_FROM="Acme SaaS <billing@acme.test>"

# Storage
INVOICE_DIR=./invoices

# Scheduler (demo: every minute. Production default: daily at 09:00 -> "0 9 * * *")
CRON_SCHEDULE=*/1 * * * *
REMINDER_WINDOW_DAYS=3
```

#### Getting the free credentials

**Stripe secret key**
1. Create an account at https://dashboard.stripe.com/register and stay in **Test mode**.
2. Go to **Developers → API keys** and copy the **Secret key** (`sk_test_...`).

**Stripe prices (the three plans on the checkout page)**
1. Go to **Product catalog → Add product**.
2. Create three monthly recurring products, for example Starter, Pro and Business, with any prices.
3. Copy each **Price ID** (`price_...`) into `PRICE_100`, `PRICE_500` and `PRICE_1000`. These match the Starter, Pro and Business options on the checkout page.

**Stripe webhook secret**: see [Forwarding Stripe webhooks](#forwarding-stripe-webhooks) below.

**Mailtrap**
1. Sign up at https://mailtrap.io (free) and open **Email Testing → Inboxes → your inbox → SMTP Settings**.
2. Copy the host, port, username and password into the `SMTP_*` variables.

If you leave `SMTP_HOST` empty, the app creates a free Ethereal test inbox automatically and prints preview links in the terminal.

### 3. Start PostgreSQL and Redis

```bash
docker compose up -d
docker ps
```

`saas_postgres` and `saas_redis` should be listed as running.

### 4. Create the database tables

```bash
npx prisma migrate deploy
npx prisma generate
```

---

## Running the Application

Use separate terminals, all in the project folder.

**Terminal 1: the app** (API, email worker and cron all start together)

```bash
npm run dev
```

Expected startup lines:

```
Server listening on http://localhost:3000
[Worker] Email worker started, listening for jobs...
[Cron] Renewal cron scheduled: "*/1 * * * *"
```

**Terminal 2: Stripe webhook forwarding**

```bash
stripe login          # first time only
stripe listen --events checkout.session.completed,invoice.paid --forward-to localhost:3000/api/webhook
```

**Terminal 3 (optional): database viewer**

```bash
npx prisma studio     # opens http://localhost:5555
```

### Forwarding Stripe webhooks

`stripe listen` prints a line like `Your webhook signing secret is whsec_...`. Copy that value into `STRIPE_WEBHOOK_SECRET` in `.env`, then restart `npm run dev`. Keep the `stripe listen` terminal open while testing payments.

(Alternative: expose the app with ngrok and add `https://<id>.ngrok.io/api/webhook` as an endpoint in the Stripe dashboard for the events `checkout.session.completed` and `invoice.paid`.)

---

## Verifying Each Requirement

### Requirement 1: Checkout and webhook

1. Open http://localhost:3000, enter an email, choose a plan and click **Subscribe Now**.
2. On the Stripe page pay with the test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. In the app terminal you will see the webhook being received and processed. In the `stripe listen` terminal you will see `200` responses.
4. In Prisma Studio, the **User**, **Subscription** (`status = active`) and **Invoice** tables now contain the new records.

The webhook verifies Stripe's signature, and processing is idempotent: Stripe delivers events at least once, and a repeated event does not create a duplicate invoice because `stripeInvoiceId` is unique.

### Requirement 2: Invoice and email

1. After the payment, open your Mailtrap inbox (or the Ethereal preview link in the terminal). The email contains the subscription details, the invoice PDF as an attachment, and a download link.
2. The PDF is stored in `./invoices/INV-<timestamp>.pdf`.
3. The link in the email, `GET /api/invoices/:id`, downloads the stored PDF.

### Requirement 3: Background jobs, queue and cache

**Cron and Redis queue (renewal reminders)**

1. Make sure `CRON_SCHEDULE=*/1 * * * *` is set and the app is running.
2. In Prisma Studio, open **Subscription** and edit one row: `status = active`, `currentPeriodEnd` = a date about 2 days from now, `reminderSentAt` = empty. Click **Save 1 change**.
3. Within a minute the app terminal shows:

```
[Cron] Found 1 subscription(s) expiring soon
[Cron] Queued renewal reminder for you@example.com
[Worker] Sending renewal reminder to you@example.com
[Worker] Renewal reminder sent to you@example.com
```

4. The reminder email arrives in the inbox, and `reminderSentAt` is now filled in.
5. The next cron run reports `Found 0`, so no duplicate is sent.

How duplicates are prevented: the job id is derived from the subscription and its period end, and `reminderSentAt` is set by the worker only after the email is really sent. If the send fails, BullMQ retries 3 times with exponential backoff and the reminder is not lost. When a subscription renews, `reminderSentAt` is reset so the next period gets its own reminder.

**Redis cache (metrics)**

1. Open http://localhost:3000/api/metrics. The first response has `"cached": false` and the terminal shows `Cache MISS`.
2. Refresh within 60 seconds: `"cached": true`, `Cache HIT`, and the same `cachedAt`.
3. After a new payment the cache is invalidated (`[Metrics] Cache invalidated`), so the next request is a MISS with fresh numbers.

**Inspecting Redis directly**

```bash
docker exec -it saas_redis redis-cli
KEYS *
TTL platform:metrics
KEYS bull:renewal-reminders:*
```

`platform:metrics` is the cache key (a string with a 60 second TTL). The `bull:renewal-reminders:*` keys are the BullMQ queue data.

---

## MCP Server (AI Agent Interface)

A real MCP server (stdio transport) that Claude Desktop, or any MCP client, can launch. It exposes **read-only** tools and reuses the same metrics service as the API, so it also benefits from the Redis cache.

### Tools

| Tool | Description |
|------|-------------|
| `get_platform_stats` | All metrics: active subscribers, simulated revenue, monthly recurring revenue, total users and invoices, and a `cached` flag |
| `get_active_subscribers` | Total number of currently active subscribers |
| `get_revenue_summary` | Total simulated revenue (Stripe Test Mode) and monthly recurring revenue |
| `list_expiring_subscriptions` | Active subscriptions expiring within `days` (1 to 90, default 7). Emails are masked |

"Active" means `status = active` and `currentPeriodEnd` in the future. Revenue is the sum of real invoice amounts from Stripe test payments.

### Build

PostgreSQL and Redis must be running (`docker compose up -d`). The `npm run dev` app does not need to be running, because the MCP server is its own process.

```bash
npm run build
```

### Test with the MCP Inspector (no Claude Desktop needed)

```bash
npx @modelcontextprotocol/inspector node dist/mcp/server.js
```

Open the link it prints, click **Connect**, then **Tools → List Tools**. You should see the 4 tools. Run `get_platform_stats` twice: the first result has `"cached": false` and the second `"cached": true`.

### Use with Claude Desktop

1. Open **Claude Desktop → Settings → Developer → Edit config**. This opens the exact config file your installation uses.
   - Standard install (Windows): `%APPDATA%\Claude\claude_desktop_config.json`
   - Microsoft Store install (Windows): `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the server under the top-level `mcpServers` key. Use the absolute path to the built file (on Windows, double the backslashes):

```json
{
  "mcpServers": {
    "saas-platform": {
      "command": "node",
      "args": [
        "C:\\path\\to\\saas-subscription-platform\\dist\\mcp\\server.js"
      ]
    }
  }
}
```

If the file already has other content (for example a `preferences` section), keep it and add `mcpServers` as another top-level key, separated by a comma.

3. **Fully quit and restart Claude Desktop** (quit from the system tray, not just close the window). The config is only read at startup.
4. In **Settings → Developer**, `saas-platform` should be listed as running.
5. Start a new chat and ask, for example:
   - "How many active subscribers do we have?"
   - "What is our total revenue and monthly recurring revenue?"
   - "Which subscriptions expire in the next 7 days?"

Allow the tool call when Claude asks. If you change the code, run `npm run build` again and restart Claude Desktop.

### Implementation notes

- An MCP stdio server communicates over stdout, so any stray `console.log` would corrupt the protocol. `src/mcp/bootstrap.ts` is imported first and redirects all logging to stderr.
- Claude Desktop starts the server from an unknown working directory, so `bootstrap.ts` loads `.env` by absolute path.
- The tools are read-only and customer emails are masked.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ping` | Health check |
| `POST` | `/api/checkout` | Create a Stripe Checkout session (`{ email, plan }`) |
| `POST` | `/api/webhook` | Stripe webhook (signature verified) |
| `GET` | `/api/invoices/:id` | Download an invoice PDF |
| `GET` | `/api/metrics` | Platform metrics (Redis-cached) |

---

## Design Decisions

- **The webhook is the source of truth.** The success page does not activate anything. Only the signed webhook creates or updates users, subscriptions and invoices.
- **Idempotent webhook processing.** Stripe retries deliveries, so duplicates are detected through the unique `stripeInvoiceId`.
- **Queue instead of inline email for reminders.** The cron only enqueues jobs. Sending is done by a worker with retries and backoff, so a slow or failing mail server never blocks or loses reminders. The queue is stored in Redis, so jobs survive an app restart.
- **Cache-aside metrics with invalidation.** Metrics are read from Redis (60 second TTL) and fall back to PostgreSQL. The cache is cleared when a payment changes the numbers, and Redis calls have a timeout so an unavailable Redis does not hang the API or the MCP server.
- **Local invoice storage.** PDFs are written to `INVOICE_DIR`, which keeps the project free and self-contained. The path is stored in the database.
- **MCP as a separate process.** The AI interface is isolated from the web server, read-only, and reuses the existing service layer instead of duplicating queries.

### Known limitations

- Stripe Test Mode only. Revenue figures are simulated test payments.
- The confirmation email is sent while handling the webhook. A failure there is logged but not retried (reminder emails do use the retrying queue).
- Invoices live on local disk. For production they would move to object storage such as S3.

---

## Docker Compose Reference

```bash
docker compose up -d        # start PostgreSQL and Redis
docker compose down         # stop containers
docker compose logs -f      # follow logs
docker compose down -v      # stop and delete data volumes (full reset)
```

---

## Scripts

```bash
npm run dev        # API + worker + cron with hot reload (ts-node-dev)
npm run build      # compile TypeScript to dist/
npm start          # run the compiled app
npm run mcp:dev    # run the MCP server with ts-node (for quick testing)
npm run mcp        # run the compiled MCP server (dist/mcp/server.js)
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BASE_URL` | Public base URL, used in email links | `http://localhost:3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/saas` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `STRIPE_SECRET_KEY` | Stripe secret key (Test Mode) | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from `stripe listen` | `whsec_...` |
| `PRICE_100` / `PRICE_500` / `PRICE_1000` | Stripe Price IDs for the three plans | `price_...` |
| `SMTP_HOST` | SMTP host. Empty means an Ethereal test inbox is created automatically | `sandbox.smtp.mailtrap.io` |
| `SMTP_PORT` | SMTP port | `2525` |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials | `your_mailtrap_user` |
| `MAIL_FROM` | Sender address | `Acme SaaS <billing@acme.test>` |
| `INVOICE_DIR` | Directory for generated PDFs | `./invoices` |
| `CRON_SCHEDULE` | Cron expression for the expiry scan | `0 9 * * *` (daily at 09:00), `*/1 * * * *` for demos |
| `REMINDER_WINDOW_DAYS` | Send a reminder when a subscription ends within this many days | `3` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `failed to connect to the docker API` | Start Docker Desktop and wait until the engine is running |
| Webhook returns 400 | `STRIPE_WEBHOOK_SECRET` does not match the secret printed by `stripe listen`. Update `.env` and restart the app |
| `stripe listen` asks for events | Use `--events checkout.session.completed,invoice.paid` as shown above |
| Cron finds 0 subscriptions | The subscription must be `active`, end within `REMINDER_WINDOW_DAYS` and have an empty `reminderSentAt` |
| MCP Inspector shows a parse error | Run `npm run build` again and make sure `bootstrap.ts` is the first import in `src/mcp/server.ts` |
| Claude Desktop does not list `saas-platform` | Edit the file opened by **Settings → Developer → Edit config**, validate the JSON, then fully quit and restart Claude Desktop |
| Tools return an error | Check that Docker is running and that `DATABASE_URL` and `REDIS_URL` point to `localhost` |

---
