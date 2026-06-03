import { Router } from "express";
import { getGuards } from "../services/dataStore.js";

export const guardsRouter = Router();

guardsRouter.get("/", async (_req, res, next) => {
  try {
    const guards = await getGuards();
    res.json({ guards });
  } catch (err) {
    next(err);
  }
});
