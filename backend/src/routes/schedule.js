import { Router } from "express";
import { getSchedule } from "../services/dataStore.js";

export const scheduleRouter = Router();

scheduleRouter.get("/", async (req, res, next) => {
  try {
    const { date } = req.query;
    const schedule = await getSchedule();
    const shifts = date ? schedule.filter((s) => s.shift_date === date) : schedule;
    res.json({ shifts });
  } catch (err) {
    next(err);
  }
});
