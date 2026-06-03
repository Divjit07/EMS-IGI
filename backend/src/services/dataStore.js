import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

async function readJson(file) {
  const raw = await readFile(join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw);
}

/**
 * Data access layer. Phase 1 reads bundled JSON.
 *
 * To move to Phase 1-production (Google Sheets) or Phase 2 (TrackTik),
 * implement getGuards()/getSchedule() against those APIs and switch on
 * process.env.DATA_SOURCE. The rest of the app is unaffected.
 */
const source = (process.env.DATA_SOURCE || "local").toLowerCase();

export async function getGuards() {
  if (source === "local") return readJson("guards.json");
  throw new Error(
    `DATA_SOURCE="${source}" not implemented yet. Use "local" for Phase 1.`
  );
}

export async function getSchedule() {
  if (source === "local") return readJson("schedule.json");
  throw new Error(
    `DATA_SOURCE="${source}" not implemented yet. Use "local" for Phase 1.`
  );
}

export function getDataSource() {
  return source;
}
