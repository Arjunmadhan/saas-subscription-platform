import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { prisma } from "../config/prisma";

export async function createInvoice(p: {
  subscriptionId: string;
  amount: number;
  currency: string;
  stripeInvoiceId?: string | null;
}) {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id: p.subscriptionId },
    include: { user: true },
  });

  const dir = path.resolve(process.env.INVOICE_DIR || "./invoices");
  await fs.promises.mkdir(dir, { recursive: true });

  const number = `INV-${Date.now()}`;
  const filePath = path.join(dir, `${number}.pdf`);

  // DB row first: the unique stripeInvoiceId blocks duplicate webhook processing
  const invoice = await prisma.invoice.create({
    data: {
      number,
      stripeInvoiceId: p.stripeInvoiceId ?? null,
      amount: p.amount,
      currency: p.currency,
      filePath,
      subscriptionId: sub.id,
    },
  });

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const out = fs.createWriteStream(filePath);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);

    doc.fontSize(22).text("INVOICE", { align: "right" });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Invoice #: ${number}`);
    doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text(`Billed to: ${sub.user.name || sub.user.email}`);
    doc.text(`Email: ${sub.user.email}`);
    doc.moveDown();
    doc.text(`Subscription: ${sub.stripeId}`);
    doc.text(
      `Period: ${sub.currentPeriodStart.toISOString().slice(0, 10)} to ${sub.currentPeriodEnd.toISOString().slice(0, 10)}`
    );
    doc.moveDown();
    doc.fontSize(14).text(`Amount paid: ${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`);
    doc.end();
  });

  return invoice;
}