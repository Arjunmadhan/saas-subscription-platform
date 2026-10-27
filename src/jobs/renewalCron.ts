import cron from "node-cron";
import { emailQueue } from "./queue";
import { prisma } from "../config/prisma";

const REMINDER_WINDOW_DAYS = Number(process.env.REMINDER_WINDOW_DAYS || 3);

export async function checkExpiringSubscriptions() {
  console.log("[Cron] Checking for expiring subscriptions...");

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const expiringSubs = await prisma.subscription.findMany({
      where: {
        status: "active",
        currentPeriodEnd: { gte: now, lte: windowEnd },
        reminderSentAt: null,
      },
      include: { user: true },
    });

    console.log(`[Cron] Found ${expiringSubs.length} subscription(s) expiring soon`);

    for (const sub of expiringSubs) {
      const expiryDate = sub.currentPeriodEnd.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
      await emailQueue.add(
        "renewal-reminder",
        {
          subscriptionId: sub.id,
          email: sub.user.email,
          name: sub.user.name || sub.user.email,
          expiryDate,
        },
        {
          jobId: `reminder-${sub.id}-${sub.currentPeriodEnd.getTime()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { age: 24 * 3600 },
        }
      );

      console.log(`[Cron] Queued renewal reminder for ${sub.user.email}`);
    }
  } catch (err: any) {
    console.error("[Cron] Error checking expiring subscriptions:", err.message);
  }
}

export function startRenewalCron() {
  const schedule = process.env.CRON_SCHEDULE || "0 9 * * *";

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: "${schedule}"`);
  }

  const task = cron.schedule(schedule, () => {
    checkExpiringSubscriptions();
  });

  console.log(`[Cron] Renewal cron scheduled: "${schedule}"`);
  return task;
}