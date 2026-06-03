import "dotenv/config";
import express from "express";
import cors from "cors";
import { guardsRouter } from "./routes/guards.js";
import { scheduleRouter } from "./routes/schedule.js";
import { coverageRouter } from "./routes/coverage.js";
import { parseShiftRouter } from "./routes/parseShift.js";
import { contactLogRouter } from "./routes/contactLog.js";
import { getDataSource } from "./services/dataStore.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "shift-coverage-backend",
    dataSource: getDataSource(),
  });
});

app.use("/api/parse-shift", parseShiftRouter);
app.use("/api/coverage", coverageRouter);
app.use("/api/guards", guardsRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/contact-log", contactLogRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: err.message || "Something went wrong.",
  });
});

app.listen(port, () => {
  console.log(`Shift Coverage backend running at http://localhost:${port}`);
});
