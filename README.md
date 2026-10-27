# SaaS Subscription Platform

A full-stack mini SaaS backend with Stripe subscriptions, invoice generation, email delivery, Redis-backed job queues, and an AI-agent MCP interface.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Database | PostgreSQL (via Prisma ORM) |
| Cache / Queue | Redis + BullMQ |
| Payments | Stripe (Test Mode) |
| Email | Nodemailer + Mailtrap |
| PDF Generation | PDFKit |
| Containerisation | Docker + Docker Compose |
| AI Interface | MCP (Model Context Protocol) HTTP endpoint |

---

## Project Structure

```
saas-subscription-platform/
├── src/
│   ├── index.ts                  # Express server entry point
│   ├── routes/
│   │   ├── checkout.ts           # Stripe checkout + webhook
│   │   ├── invoice.ts            # Invoice generation & storage
│   │   ├── email.ts              # Email sender via Nodemailer
│   │   └── mcp.ts                # MCP metrics endpoint
│   ├── services/
│   │   ├── subscription.service.ts
│   │   ├── invoice.service.ts
│   │   ├── email.service.ts
│   │   └── metrics.service.ts
│   ├── jobs/
│   │   └── renewalReminder.ts    # BullMQ cron job
│   ├── config/
│   └── utils/
├── prisma/
│   └── schema.prisma             # Database schema
├── public/
│   ├── index.html                # Checkout UI
│   ├── success.html              # Payment success page
│   └── cancel.html               # Payment cancelled page
├── invoices/                     # Generated PDF invoices (auto-created)
├── docker-compose.yml            # PostgreSQL + Redis containers
├── .env.example                  # Sample environment variables
├── tsconfig.json
└── package.json
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL & Redis)
- [Stripe Account](https://dashboard.stripe.com/) (free, Test Mode)
- [Mailtrap Account](https://mailtrap.io/) (free, for email testing)
- [ngrok](https://ngrok.com/) (for exposing local webhook to Stripe)

---

## Setup

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd saas-subscription-platform
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the following values:

```ini
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/saas
REDIS_URL=redis://localhost:6379

# From Stripe Dashboard → Developers → API Keys (Test Mode)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# From Mailtrap → Inboxes → SMTP Settings
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_password

INVOICE_DIR=./invoices
```

### 4. Start PostgreSQL & Redis with Docker

```bash
docker compose up -d
```

Verify containers are running:

```bash
docker ps
```

You should see `saas_postgres` and `saas_redis` running.

### 5. Run database migrations

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 6. Start the development server

```bash
npm run dev
```

Server will be running at: **http://localhost:3000**

---

## Running the Application

### Checkout Flow (UI)

1. Open **http://localhost:3000** in your browser
2. Enter a test email and a Stripe **Price ID** (e.g. `price_1ABC...`)
3. Click **Subscribe Now** — you will be redirected to Stripe Checkout
4. Use the Stripe test card: `4242 4242 4242 4242` | Any future date | Any CVC
5. On success you land on the success page and the webhook fires

### Create a Stripe Test Product & Price

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Product catalog**
2. Click **Add product** → Name it (e.g. `Pro Plan`) → Set price `$10 / month`
3. Copy the **Price ID** (starts with `price_`) — paste it in the UI

---

## Exposing the Stripe Webhook Locally

Stripe cannot reach `localhost` directly. Use **ngrok**:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding URL (e.g. `https://abc123.ngrok.io`) and:

1. Go to Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: `https://abc123.ngrok.io/api/webhook`
3. Select event: `checkout.session.completed`
4. Click **Create** → copy the **Signing secret** (`whsec_...`) → paste into `.env`

---

## Verifying Background Jobs

The renewal reminder cron job (BullMQ) runs automatically on server start.

To monitor queued jobs, you can add **bull-board** or check logs in the terminal.

Manually trigger a check:
```bash
# Subscriptions expiring in 3 days will be queued for reminder emails
# Check terminal output for "Queued renewal reminder for <email>"
```

---

## AI Agent Interface (MCP)

The server exposes an MCP-compatible endpoint for AI assistants:

### Endpoint

```
GET http://localhost:3000/mcp/metrics
```

### Response

```json
{
  "modelContextProtocolVersion": "1.0",
  "timestamp": "2026-10-27T00:00:00.000Z",
  "metrics": {
    "totalActiveSubscribers": 5,
    "simulatedRevenueUSD": 50.00
  }
}
```

### Using with Claude Desktop

1. Open Claude Desktop → **Settings** → **Model Context Protocol**
2. Add endpoint: `http://localhost:3000/mcp/metrics`
3. Ask Claude: *"What is the current subscription health?"*

### Using with a Local LLM (Python example)

```python
import requests

metrics = requests.get("http://localhost:3000/mcp/metrics").json()
prompt = f"Summarise: {metrics['metrics']}"
# Pass prompt to your local LLM (Ollama, etc.)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ping` | Health check |
| `POST` | `/api/checkout` | Create Stripe Checkout Session |
| `POST` | `/api/webhook` | Stripe webhook handler |
| `GET` | `/mcp/metrics` | AI agent metrics (MCP) |

---

## Docker Compose Reference

```bash
# Start containers
docker compose up -d

# Stop containers
docker compose down

# View container logs
docker compose logs -f

# Reset database (delete volume)
docker compose down -v
```

---

## Development Scripts

```bash
npm run dev      # Start server with hot-reload (ts-node-dev)
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled server
```

---

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `STRIPE_SECRET_KEY` | Stripe secret API key (Test) | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `SMTP_HOST` | SMTP host (Mailtrap) | `smtp.mailtrap.io` |
| `SMTP_PORT` | SMTP port | `2525` |
| `SMTP_USER` | SMTP username | `your_mailtrap_user` |
| `SMTP_PASS` | SMTP password | `your_mailtrap_pass` |
| `INVOICE_DIR` | Local directory for PDF invoices | `./invoices` |

---

## License

MIT