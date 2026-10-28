import nodemailer, { Transporter } from "nodemailer";
import { logger } from "../utils/logger";

let cached: Promise<Transporter> | null = null;

export function getTransporter(): Promise<Transporter> {
  if (!cached) {
    cached = (async () => {
      if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
      }
      const acc = await nodemailer.createTestAccount();
      logger.info(`Using Ethereal test account: ${acc.user}`);
      return nodemailer.createTransport({
        host: acc.smtp.host,
        port: acc.smtp.port,
        secure: acc.smtp.secure,
        auth: { user: acc.user, pass: acc.pass },
      });
    })();
  }
  return cached;
}