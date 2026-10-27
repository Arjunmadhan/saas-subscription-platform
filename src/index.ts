import dotenv from "dotenv";
import express from "express";
import path from "path";
import checkoutRouter from "./routes/checkout";
import invoicesRouter from "./routes/invoices";
import metricsRouter from "./routes/metrics";
import { startEmailWorker } from "./jobs/emailWorker";
import { startRenewalCron } from "./jobs/renewalCron";

dotenv.config();

const app = express();

// Stripe webhook needs raw body - must be before express.json()
app.use("/api/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Routes
app.use("/api", checkoutRouter);
app.use("/api", invoicesRouter);
app.use("/api", metricsRouter);
app.get("/ping", (_req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  // Start BullMQ email worker (listens to Redis queue)
  startEmailWorker();

  // Start renewal reminder cron (runs every 24h)
  startRenewalCron();
});
