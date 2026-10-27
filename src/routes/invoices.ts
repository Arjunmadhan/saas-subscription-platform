import { Router } from "express";
import fs from "fs";
import { prisma } from "../config/prisma";

const router = Router();

router.get("/invoices/:id", async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice || !fs.existsSync(invoice.filePath)) {
    return res.status(404).json({ error: "Invoice not found" });
  }
  return res.download(invoice.filePath, `${invoice.number}.pdf`);
});

export default router;