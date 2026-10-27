import express from "express";
import path from "path";
import dotenv from "dotenv";
import checkoutRouter from "./routes/checkout";

dotenv.config();

const app = express();

app.use("/api/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", checkoutRouter);
app.get("/ping", (_req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on http://localhost:" + PORT));
