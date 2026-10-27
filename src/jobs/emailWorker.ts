import { Job, Worker } from "bullmq";
import nodemailer from "nodemailer";
import { getTransporter } from "../config/mailer";
import { prisma } from "../config/prisma";
import { connection } from "./queue";

export interface RenewalJobData {
  subscriptionId: string;
  email: string;
  name: string;
  expiryDate: string;
}

export function startEmailWorker() {
  const worker = new Worker<RenewalJobData>(
    "renewal-reminders",
    async (job: Job<RenewalJobData>) => {
      const { subscriptionId, email, name, expiryDate } = job.data;

      const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub || sub.reminderSentAt) {
        console.log(`[Worker] Skipping ${email}: reminder already sent or subscription missing`);
        return;
      }

      console.log(`[Worker] Sending renewal reminder to ${email}`);

      const transporter = await getTransporter();
      const info = await transporter.sendMail({
        from: process.env.MAIL_FROM || "billing@saas.local",
        to: email,
        subject: "Your subscription is expiring soon",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2 style="color: #5469d4;">Subscription Renewal Reminder</h2>
            <p>Hi ${name || "there"},</p>
            <p>Your subscription is expiring on <strong>${expiryDate}</strong>.</p>
            <p>Please renew your subscription to continue enjoying uninterrupted access.</p>
            <p style="margin-top:24px; color:#999; font-size:12px;">
              If you have already renewed, please ignore this email.
            </p>
          </div>
        `,
      });

      // Mark as sent ONLY after the email really went out
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { reminderSentAt: new Date() },
      });

      const preview = nodemailer.getTestMessageUrl(info);
      console.log(`[Worker] Renewal reminder sent to ${email}${preview ? ` | preview: ${preview}` : ""}`);
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Worker] Email worker started, listening for jobs...");
  return worker;
}