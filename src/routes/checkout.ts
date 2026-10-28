import { Request, Response, Router } from "express";
import Stripe from "stripe";
import { prisma } from "../config/prisma";
import { sendConfirmationEmail } from "../services/email";
import { createInvoice } from "../services/invoice";
import { invalidateMetricsCache } from "../services/metrics.service";
import { logger } from "../utils/logger";

const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20" as any,
});

async function processPayment(a: {
  email: string;
  name?: string | null;
  subscriptionId: string;
  amount: number;
  currency: string;
  stripeInvoiceId?: string | null;
}) {
  console.log("\n========== PROCESS PAYMENT STARTED ==========");
  console.log("Payment details:", {
    email: a.email,
    subscriptionId: a.subscriptionId,
    amount: a.amount,
    currency: a.currency,
    stripeInvoiceId: a.stripeInvoiceId,
  });

  try {
    if (a.stripeInvoiceId) {
      console.log("Checking existing invoice...");

      const existing = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: a.stripeInvoiceId },
      });

      if (existing) {
        console.log("Duplicate invoice found. Skipping:", existing.id);
        return;
      }

      console.log("No existing invoice found. Continuing...");
    }

    console.log("Upserting user...");

    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: {
        name: a.name ?? undefined,
      },
      create: {
        email: a.email,
        name: a.name ?? "",
      },
    });

    console.log("USER UPSERT SUCCESS:", user);

    console.log("Retrieving Stripe subscription...");

    const subscription: any = await stripe.subscriptions.retrieve(
      a.subscriptionId
    );

    console.log("STRIPE SUBSCRIPTION:", {
      id: subscription.id,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
    });

    const subscriptionData = {
      status: subscription.status as string,
      currentPeriodStart: new Date(
        subscription.current_period_start * 1000
      ),
      currentPeriodEnd: new Date(
        subscription.current_period_end * 1000
      ),
      amount: a.amount,
      currency: a.currency,
      reminderSentAt: null,
    };

    console.log("Upserting subscription...");

    const sub = await prisma.subscription.upsert({
      where: { stripeId: a.subscriptionId },
      update: subscriptionData,
      create: {
        ...subscriptionData,
        stripeId: a.subscriptionId,
        userId: user.id,
      },
    });

    console.log("SUBSCRIPTION UPSERT SUCCESS:", sub);

    console.log("Creating invoice...");

    let invoice;

    try {
      invoice = await createInvoice({
        subscriptionId: sub.id,
        amount: a.amount,
        currency: a.currency,
        stripeInvoiceId: a.stripeInvoiceId,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        console.warn("Duplicate invoice detected:", a.stripeInvoiceId);
        return;
      }

      throw error;
    }

    console.log("INVOICE CREATED SUCCESS:", invoice);

    try {
      console.log("Sending confirmation email...");
      await sendConfirmationEmail(invoice.id);
      console.log("CONFIRMATION EMAIL SENT SUCCESS");
    } catch (error: any) {
      console.error("EMAIL FAILED:", error.message);
      logger.error("Email failed: " + error.message);
    }

    await invalidateMetricsCache();

    console.log("========== PROCESS PAYMENT COMPLETED ==========\n");
  } catch (error: any) {
    console.error("PROCESS PAYMENT FAILED:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    });

    throw error;
  }
}

function getPriceId(plan: string): string | undefined {
  const plans: Record<string, string | undefined> = {
    "100": process.env.PRICE_100,
    "500": process.env.PRICE_500,
    "1000": process.env.PRICE_1000,
  };

  return plans[plan];
}

router.post("/checkout", async (req: Request, res: Response) => {
  const { name, email, plan } = req.body;
  const priceId = getPriceId(String(plan));

  if (!email || !priceId) {
    return res.status(400).json({});
  }

  try {
    console.log("Creating Stripe Checkout Session:", { email, plan });

    const customer = await stripe.customers.create({
      name,
      email,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customer.id,
      success_url:
        "http://localhost:3000/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3000/cancel.html",
    });

    console.log("CHECKOUT SESSION CREATED:", {
      sessionId: session.id,
      customerId: customer.id,
      checkoutUrlCreated: Boolean(session.url),
    });

    return res.json({ checkoutUrl: session.url });
  } catch (error: any) {
    console.error("CHECKOUT CREATION FAILED:", error.message);
    logger.error("Checkout error: " + error.message);

    return res.status(500).json({
      error: "Failed to create checkout session",
    });
  }
});

router.post("/webhook", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: any) {
    console.error("WEBHOOK SIGNATURE VERIFICATION FAILED:", error.message);
    logger.error("Webhook signature verification failed: " + error.message);

    return res.sendStatus(400);
  }

  console.log("\n========== STRIPE WEBHOOK RECEIVED ==========");
  console.log("Event type:", event.type);
  console.log("Event ID:", event.id);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      console.log("CHECKOUT SESSION EVENT:", {
        sessionId: session.id,
        mode: session.mode,
        customer: session.customer,
        customerEmail: session.customer_details?.email,
        subscription: session.subscription,
        invoice: session.invoice,
        amountTotal: session.amount_total,
        currency: session.currency,
      });

      if (session.mode === "subscription" && session.subscription) {
        let email = session.customer_details?.email ?? null;
        let name = session.customer_details?.name ?? null;

        if (!email && session.customer) {
          const customerId =
            typeof session.customer === "string"
              ? session.customer
              : session.customer.id;

          console.log("Retrieving customer for checkout session:", customerId);

          const customer = await stripe.customers.retrieve(customerId);

          if (!customer.deleted) {
            email = customer.email ?? null;
            name = name ?? customer.name ?? null;
          }
        }

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;

        if (email) {
          await processPayment({
            email,
            name,
            subscriptionId,
            amount: session.amount_total ?? 0,
            currency: session.currency ?? "usd",
            stripeInvoiceId:
              typeof session.invoice === "string"
                ? session.invoice
                : session.invoice?.id ?? null,
          });
        } else {
          console.error(
            "No customer email found for checkout session:",
            session.id
          );
        }
      } else {
        console.log(
          "Checkout session skipped: missing subscription or wrong mode."
        );
      }
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as any;

      console.log("INVOICE PAID EVENT:", {
        invoiceId: invoice.id,
        customer: invoice.customer,
        customerEmail: invoice.customer_email,
        subscription: invoice.subscription,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
      });

      const rawSubscription =
        invoice.subscription ??
        invoice.parent?.subscription_details?.subscription;

      const subscriptionId =
        typeof rawSubscription === "string"
          ? rawSubscription
          : rawSubscription?.id;

      if (subscriptionId) {
        let email = invoice.customer_email ?? null;
        let name = invoice.customer_name ?? null;

        if (!email && invoice.customer) {
          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer.id;

          console.log("Retrieving customer for invoice:", customerId);

          const customer = await stripe.customers.retrieve(customerId);

          if (!customer.deleted) {
            email = customer.email ?? null;
            name = name ?? customer.name ?? null;
          }
        }

        if (email) {
          await processPayment({
            email,
            name,
            subscriptionId,
            amount: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? "usd",
            stripeInvoiceId: invoice.id,
          });
        } else {
          console.error(
            "No customer email found for invoice:",
            invoice.id
          );
        }
      } else {
        console.error(
          "No subscription ID found for invoice:",
          invoice.id
        );
      }
    } else {
      console.log("Event received; no payment processing required:", event.type);
    }
  } catch (error: any) {
    console.error("WEBHOOK PROCESSING FAILED:", {
      eventType: event.type,
      eventId: event.id,
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    });

    logger.error("Webhook processing error: " + error.message);

    return res.sendStatus(500);
  }

  console.log("WEBHOOK PROCESSING FINISHED:", event.type);
  return res.json({ received: true });
});

export default router;