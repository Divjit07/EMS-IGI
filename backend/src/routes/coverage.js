import { Router } from "express";
import { getGuards, getSchedule } from "../services/dataStore.js";
import { findAvailableGuards } from "../utils/availability.js";

export const coverageRouter = Router();

coverageRouter.post("/", async (req, res, next) => {
  try {
    const {
      shiftDate,
      startTime,
      endTime,
      siteName,
      siteAddress,
      shiftCode,
      siteLat,
      siteLng,
      radiusKm = 10,
    } = req.body;

    const missing = [];
    if (!shiftDate) missing.push("shiftDate");
    if (!startTime) missing.push("startTime");
    if (!endTime) missing.push("endTime");
    if (siteLat == null) missing.push("siteLat");
    if (siteLng == null) missing.push("siteLng");

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const [guards, schedule] = await Promise.all([getGuards(), getSchedule()]);
    const result = findAvailableGuards({
      guards,
      schedule,
      shiftDate,
      startTime,
      endTime,
      radiusKm: Number(radiusKm),
      site: {
        name: siteName,
        address: siteAddress,
        code: shiftCode,
        lat: Number(siteLat),
        lng: Number(siteLng),
      },
    });

    res.json({
      shift: {
        shiftDate,
        startTime,
        endTime,
        siteName,
        siteAddress,
        shiftCode,
        siteLat: Number(siteLat),
        siteLng: Number(siteLng),
        radiusKm: Number(radiusKm),
      },
      ...result,
    });
  } catch (err) {
    next(err);
  }
});
