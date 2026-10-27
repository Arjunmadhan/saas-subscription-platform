import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" as any });
const prisma = new PrismaClient();


router.post("/checkout", async (req: Request, res: Response) => {
  const { email, priceId } = req.body;
  if (!email || !priceId) {
    return res.status(400).json({ error: "email and priceId are required" });
  }
  try {
    const customer = await stripe.customers.create({ email });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customer.id,
      success_url: "http://localhost:3000/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3000/cancel.html",
    });
    return res.json({ checkoutUrl: session.url });
  } catch (e: any) {
    console.error("Checkout error:", e.message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = session.subscription as string;
    const email = session.customer_details?.email;

    if (!email) return res.sendStatus(200);

    try {
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: session.customer_details?.name ?? "" },
      });

      const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);

      await prisma.subscription.upsert({
        where: { stripeId: subscriptionId },
        update: {
          status: stripeSub.status,
          currentPeriodStart: new Date((stripeSub as any).current_period_start * 1000),
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
        },
        create: {
          stripeId: subscriptionId,
          status: stripeSub.status,
          currentPeriodStart: new Date((stripeSub as any).current_period_start * 1000),
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
          userId: user.id,
        },
      });

      console.log("Subscription saved for", email);
    } catch (dbErr: any) {
      console.error("DB error:", dbErr.message);
    }
  }

  return res.json({ received: true });
});

export default router;
