import "./bootstrap"; // keep this first: redirects logs to stderr and loads .env

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getExpiringSubscriptions, getPlatformMetrics } from "../services/metrics.service";

const server = new McpServer({ name: "saas-platform", version: "1.0.0" });

const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const asError = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
});

server.tool(
  "get_platform_stats",
  "Get real-time platform statistics: total active subscribers, simulated revenue, monthly recurring revenue, total users and invoices. Served from the Redis cache when fresh (see the 'cached' field).",
  async () => {
    try {
      return asText(await getPlatformMetrics());
    } catch (err) {
      return asError(err);
    }
  }
);

server.tool(
  "get_active_subscribers",
  "Get the total number of currently active subscribers.",
  async () => {
    try {
      const m = await getPlatformMetrics();
      return asText({
        totalActiveSubscribers: m.totalActiveSubscribers,
        asOf: m.cachedAt,
        cached: m.cached,
      });
    } catch (err) {
      return asError(err);
    }
  }
);

server.tool(
  "get_revenue_summary",
  "Get total simulated revenue (Stripe test mode payments) and the current monthly recurring revenue.",
  async () => {
    try {
      const m = await getPlatformMetrics();
      return asText({
        totalRevenue: m.simulatedRevenueUSD,
        revenueByCurrency: m.revenueByCurrency,
        monthlyRecurringRevenue: m.monthlyRecurringRevenue,
        totalInvoices: m.totalInvoices,
        note: "Stripe test mode: amounts are simulated.",
        asOf: m.cachedAt,
        cached: m.cached,
      });
    } catch (err) {
      return asError(err);
    }
  }
);

server.tool(
  "list_expiring_subscriptions",
  "List active subscriptions that expire within the given number of days. Customer emails are masked.",
  { days: z.number().int().min(1).max(90).default(7).describe("Look-ahead window in days") },
  async ({ days }) => {
    try {
      return asText(await getExpiringSubscriptions(days));
    } catch (err) {
      return asError(err);
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("[MCP] saas-platform MCP server running on stdio");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});

process.stdin.on("close", () => process.exit(0));