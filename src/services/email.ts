import nodemailer from "nodemailer";
import { getTransporter } from "../config/mailer";
import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";

const BASE_URL = () => process.env.BASE_URL || "http://localhost:3000";

export async function sendConfirmationEmail(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { subscription: { include: { user: true } } },
  });
  const sub = invoice.subscription;
  const link = `${BASE_URL()}/api/invoices/${invoice.id}`;

  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || "billing@saas.local",
    to: sub.user.email,
    subject: `Subscription confirmed - ${invoice.number}`,
    text:
      `Thanks for subscribing!\n\n` +
      `Status: ${sub.status}\n` +
      `Amount: ${(invoice.amount / 100).toFixed(2)} ${invoice.currency.toUpperCase()}\n` +
      `Period: ${sub.currentPeriodStart.toISOString().slice(0, 10)} to ${sub.currentPeriodEnd.toISOString().slice(0, 10)}\n\n` +
      `Invoice: ${link}`,
    attachments: [{ filename: `${invoice.number}.pdf`, path: invoice.filePath }],
  });

  const preview = nodemailer.getTestMessageUrl(info);
  logger.info(`Confirmation email sent to ${sub.user.email}${preview ? ` | preview: ${preview}` : ""}`);
}