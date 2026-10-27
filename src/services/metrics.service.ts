import { connection } from "../jobs/queue";
import { prisma } from "../config/prisma";

const CACHE_KEY = "platform:metrics";
const CACHE_TTL = 60; // seconds

export interface PlatformMetrics {
  totalActiveSubscribers: number;
  simulatedRevenueUSD: number;
  totalUsers: number;
  totalInvoices: number;
  cachedAt: string;
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  // 1. Try Redis cache first
  const cached = await connection.get(CACHE_KEY);
  if (cached) {
    console.log("[Metrics] Cache HIT - returning cached metrics");
    return JSON.parse(cached);
  }

  console.log("[Metrics] Cache MISS - querying database...");

  // 2. Query database
  const [activeSubscribers, totalUsers, totalInvoices] = await Promise.all([
    prisma.subscription.count({
      where: { status: "active" },
    }),
    prisma.user.count(),
    prisma.invoice.count(),
  ]);

  // Simulate revenue: count active subs * $10/month
  const simulatedRevenueUSD = activeSubscribers * 10;

  const metrics: PlatformMetrics = {
    totalActiveSubscribers: activeSubscribers,
    simulatedRevenueUSD,
    totalUsers,
    totalInvoices,
    cachedAt: new Date().toISOString(),
  };

  // 3. Store in Redis cache with TTL
  await connection.set(CACHE_KEY, JSON.stringify(metrics), "EX", CACHE_TTL);
  console.log(`[Metrics] Metrics cached for ${CACHE_TTL} seconds`);

  return metrics;
}

// Call this whenever a subscription changes (invalidates cache)
export async function invalidateMetricsCache() {
  await connection.del(CACHE_KEY);
  console.log("[Metrics] Cache invalidated");
}