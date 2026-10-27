import { Router, Request, Response } from "express";
import { getPlatformMetrics } from "../services/metrics.service";

const router = Router();

// GET /api/metrics - returns Redis-cached platform stats
router.get("/metrics", async (_req: Request, res: Response) => {
  try {
    const metrics = await getPlatformMetrics();
    return res.json({
      success: true,
      data: metrics,
    });
  } catch (err: any) {
    console.error("[Metrics Route] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

export default router;