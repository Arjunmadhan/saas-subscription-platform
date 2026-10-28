import { connection } from "../jobs/queue";
import { prisma } from "../config/prisma";

const CACHE_KEY = "platform:metrics";
const CACHE_TTL = 60; // seconds
const REDIS_TIMEOUT_MS = 2000;

export interface PlatformMetrics {
  totalActiveSubscribers: number;
  /** Sum of all invoice amounts (Stripe test mode, so simulated money). Assumes one currency. */
  simulatedRevenueUSD: number;
  /** Same revenue split by currency, e.g. { USD: 29 } */
  revenueByCurrency: Record<string, number>;
  /** Sum of amounts of currently active subscriptions (monthly recurring revenue) */
  monthlyRecurringRevenue: number;
  totalUsers: number;
  totalInvoices: number;
  cachedAt: string;
}

function withTimeout<T>(promise: Promise<T>, ms = REDIS_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), ms)),
  ]);
}

export async function getPlatformMetrics(): Promise<PlatformMetrics & { cached: boolean }> {
  try {
    const cached = await withTimeout(connection.get(CACHE_KEY));
    if (cached) {
      console.log("[Metrics] Cache HIT - returning cached metrics");
      return { ...(JSON.parse(cached) as PlatformMetrics), cached: true };
    }
  } catch (err: any) {
    console.error("[Metrics] Cache read failed, falling back to database:", err.message);
  }

  console.log("[Metrics] Cache MISS - querying database...");

  const now = new Date();
  const [activeAgg, totalUsers, invoiceAgg, revenueGroups] = await Promise.all([
    prisma.subscription.aggregate({
      where: { status: "active", currentPeriodEnd: { gt: now } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.user.count(),
    prisma.invoice.count(),
    prisma.invoice.groupBy({ by: ["currency"], _sum: { amount: true } }),
  ]);

  const revenueByCurrency: Record<string, number> = {};
  let totalRevenue = 0;
  for (const g of revenueGroups) {
    const value = (g._sum.amount ?? 0) / 100;
    revenueByCurrency[g.currency.toUpperCase()] = value;
    totalRevenue += value;
  }

  const metrics: PlatformMetrics = {
    totalActiveSubscribers: activeAgg._count._all,
    simulatedRevenueUSD: totalRevenue,
    revenueByCurrency,
    monthlyRecurringRevenue: (activeAgg._sum.amount ?? 0) / 100,
    totalUsers,
    totalInvoices: invoiceAgg,
    cachedAt: now.toISOString(),
  };

  try {
    await withTimeout(connection.set(CACHE_KEY, JSON.stringify(metrics), "EX", CACHE_TTL));
    console.log(`[Metrics] Metrics cached for ${CACHE_TTL} seconds`);
  } catch (err: any) {
    console.error("[Metrics] Cache write failed:", err.message);
  }

  return { ...metrics, cached: false };
}

export async function invalidateMetricsCache() {
  try {
    await withTimeout(connection.del(CACHE_KEY));
    console.log("[Metrics] Cache invalidated");
  } catch (err: any) {
    console.error("[Metrics] Cache invalidation failed:", err.message);
  }
}

export async function getExpiringSubscriptions(days: number) {
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const subs = await prisma.subscription.findMany({
    where: { status: "active", currentPeriodEnd: { gte: now, lte: until } },
    include: { user: true },
    orderBy: { currentPeriodEnd: "asc" },
    take: 50,
  });

  return subs.map((s) => ({
    subscriptionId: s.id,
    customer: maskEmail(s.user.email),
    amount: s.amount / 100,
    currency: s.currency.toUpperCase(),
    expiresAt: s.currentPeriodEnd.toISOString(),
    reminderSent: s.reminderSentAt !== null,
  }));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}