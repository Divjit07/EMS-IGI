import { randomUUID } from "node:crypto";
import { Router } from "express";

export const contactLogRouter = Router();

const contactLog = [];

contactLogRouter.get("/", (_req, res) => {
  res.json({ entries: contactLog });
});

contactLogRouter.post("/", (req, res) => {
  const { guardId, guardName, phone, shiftCode, method = "manual call", note = "" } =
    req.body;

  if (!guardId || !guardName) {
    return res.status(400).json({ error: "guardId and guardName are required." });
  }

  const entry = {
    id: randomUUID(),
    guardId,
    guardName,
    phone,
    shiftCode,
    method,
    note,
    contactedAt: new Date().toISOString(),
  };

  contactLog.unshift(entry);
  res.status(201).json({ entry });
});
