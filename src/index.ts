import dotenv from "dotenv";
import express from "express";
import path from "path";
import checkoutRouter from "./routes/checkout";
import invoicesRouter from "./routes/invoices";

dotenv.config();

const app = express();

app.use("/api/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", checkoutRouter);
app.use("/api", invoicesRouter);
app.get("/ping", (_req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on http://localhost:" + PORT));
