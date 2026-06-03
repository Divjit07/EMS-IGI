import http from "node:http";
import { readFile } from "node:fs/promises";
import {
  createReadStream,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (zero-install: no dotenv dependency).
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3001);
const PUBLIC_DIR = join(__dirname, "public");
const DATA_DIR = join(__dirname, "backend", "src", "data");

// Runtime state is persisted here so it survives restarts.
// Override with STATE_DIR (e.g. a Render persistent disk mount).
const STATE_DIR = process.env.STATE_DIR || join(__dirname, "state");
const STATE_FILE = join(STATE_DIR, "state.json");

const contactLog = [];

// SMS coverage state (persisted to STATE_FILE).
const coverageRequests = new Map(); // requestId -> request object
const phoneToContact = new Map(); // normalized phone -> { requestId, guardId }

function saveState() {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const payload = {
      contactLog,
      // Exclude the live setTimeout handle; it can't be serialized.
      coverageRequests: [...coverageRequests.values()].map(({ timer, ...rest }) => rest),
      phoneToContact: [...phoneToContact.entries()],
    };
    writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("Failed to save state:", err.message);
  }
}

function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    if (Array.isArray(data.contactLog)) {
      contactLog.push(...data.contactLog);
    }
    for (const request of data.coverageRequests || []) {
      coverageRequests.set(request.id, request);
    }
    for (const [phone, mapping] of data.phoneToContact || []) {
      phoneToContact.set(phone, mapping);
    }
    console.log(
      `Loaded state: ${contactLog.length} log entries, ${coverageRequests.size} coverage requests.`
    );
  } catch (err) {
    console.error("Failed to load state:", err.message);
  }
}
loadState();

const demoParsedShift = {
  shiftDate: "2026-06-03",
  startTime: "15:00",
  endTime: "23:00",
  siteName: "Food Basics 841 — LP Dundas",
  siteAddress: "478 Dundas St W, Oakville, ON L6H 6Y3",
  siteLat: 43.4472,
  siteLng: -79.6931,
  shiftCode: "Food Basic 841 (LP)",
  clientCategory: "FOOD BASIC",
  lpType: "LP",
  confidence: "demo",
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(file) {
  const raw = await readFile(join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf-8"));
}

async function readFormBody(req) {
  const body = await readBody(req);
  const params = new URLSearchParams(body.toString("utf-8"));
  return Object.fromEntries(params.entries());
}

async function geocodeAddress(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !address) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

function stripJsonFence(raw) {
  return String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

async function parseWithGemini(base64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mediaType,
                data: base64,
              },
            },
            {
              text:
                "You are reading a security shift coverage notice (often a chat screenshot). " +
                "Extract the shift details and return ONLY valid JSON (no markdown, no prose) " +
                "with these keys: shiftDate (YYYY-MM-DD), startTime (HH:MM 24h), endTime (HH:MM 24h), " +
                "siteName, siteAddress, shiftCode, clientCategory (one of: METRO, FOOD BASIC, CANADIAN TIRE, " +
                "PARTY CITY, WAREHOUSE, PARKING ENFORCEMENT, or empty if unclear), " +
                "lpType (LP or LPD if the shift is loss-prevention; infer from shift code or site name when visible), " +
                "notes. Use an empty string for anything not visible.",
            },
          ],
        },
      ],
    }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 429) {
      throw new Error(
        "Gemini quota is currently exhausted for this project/key. Check Google AI Studio Rate Limit, wait for quota reset, or enable billing/increase quota."
      );
    }
    if (response.status === 400 || response.status === 403) {
      throw new Error(
        `Gemini rejected the request. Check that GEMINI_API_KEY is correct and the Gemini API is enabled. ${text.slice(0, 220)}`
      );
    }
    throw new Error(`Gemini parse failed (${response.status}). ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(stripJsonFence(raw));
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function shiftsOverlap(aStart, aEnd, bStart, bEnd) {
  let a1 = toMinutes(aStart);
  let a2 = toMinutes(aEnd);
  let b1 = toMinutes(bStart);
  let b2 = toMinutes(bEnd);
  if (a2 <= a1) a2 += 24 * 60;
  if (b2 <= b1) b2 += 24 * 60;
  return a1 < b2 && b1 < a2;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* ===================== Compliance guardrails ===================== */
// Hard rules the AI dispatcher must respect before offering a shift.
const MAX_WEEKLY_HOURS = 44; // Ontario standard work week before overtime.

function shiftHours(start, end) {
  let a = toMinutes(start);
  let b = toMinutes(end);
  if (b <= a) b += 24 * 60; // overnight shift
  return (b - a) / 60;
}

// Monday..Sunday range containing the given YYYY-MM-DD date.
function weekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const dayFromMonday = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayFromMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function weeklyHoursForGuard(guardId, schedule, range) {
  if (!range) return 0;
  return schedule
    .filter((s) => s.guard_id === guardId)
    .filter((s) => {
      const d = new Date(`${s.shift_date}T00:00:00`);
      return d >= range.start && d <= range.end;
    })
    .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0);
}

// Returns an array of human-readable reasons the guard CANNOT take the shift.
function guardrailReasons(guard, shift, weeklyHours, newShiftHours) {
  const reasons = [];

  if (guard.license_expiry) {
    const expiry = new Date(`${guard.license_expiry}T00:00:00`);
    const shiftDay = new Date(`${shift.shiftDate}T00:00:00`);
    if (!Number.isNaN(expiry.getTime()) && expiry < shiftDay) {
      reasons.push(`Security license expired ${guard.license_expiry}`);
    }
  }

  if (weeklyHours + newShiftHours > MAX_WEEKLY_HOURS) {
    reasons.push(
      `Would exceed ${MAX_WEEKLY_HOURS}h/week (${Math.round(weeklyHours)}h scheduled + ${Math.round(newShiftHours)}h this shift)`
    );
  }

  return reasons;
}

function findAvailableGuards({ guards, schedule, shift }) {
  const radiusKm = Number(shift.radiusKm || 10);
  const activeGuards = guards.filter((g) => g.status === "active");
  const shiftsToday = schedule.filter((s) => s.shift_date === shift.shiftDate);
  const range = weekRange(shift.shiftDate);
  const newShiftHours = shiftHours(shift.startTime, shift.endTime);
  const available = [];
  const availableOutOfRadius = [];
  const busy = [];
  const blocked = [];

  for (const guard of activeGuards) {
    const conflicts = shiftsToday.filter(
      (s) =>
        s.guard_id === guard.id &&
        shiftsOverlap(shift.startTime, shift.endTime, s.start_time, s.end_time)
    );

    const hasCoords =
      guard.lat != null &&
      guard.lng != null &&
      shift.siteLat != null &&
      shift.siteLng != null;
    const distanceKm = hasCoords
      ? Math.round(
          haversineKm(
            Number(guard.lat),
            Number(guard.lng),
            Number(shift.siteLat),
            Number(shift.siteLng)
          ) * 10
        ) / 10
      : null;

    const weeklyHours = weeklyHoursForGuard(guard.id, schedule, range);

    const enriched = {
      ...guard,
      certificationsList: String(guard.certifications || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      distanceKm,
      weeklyHours: Math.round(weeklyHours * 10) / 10,
      withinRadius: distanceKm == null || distanceKm <= radiusKm,
    };

    if (conflicts.length > 0) {
      busy.push({ ...enriched, busyWith: conflicts });
      continue;
    }

    const blockReasons = guardrailReasons(guard, shift, weeklyHours, newShiftHours);
    if (blockReasons.length > 0) {
      blocked.push({ ...enriched, blockReasons });
    } else if (enriched.withinRadius) {
      available.push(enriched);
    } else {
      availableOutOfRadius.push(enriched);
    }
  }

  const byDistance = (a, b) => {
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  };

  available.sort(byDistance);
  availableOutOfRadius.sort(byDistance);
  busy.sort(byDistance);
  blocked.sort(byDistance);

  return {
    shift,
    available,
    availableOutOfRadius,
    busy,
    blocked,
    counts: {
      available: available.length,
      outOfRadius: availableOutOfRadius.length,
      busy: busy.length,
      blocked: blocked.length,
      totalActive: activeGuards.length,
    },
  };
}

/* ===================== Twilio SMS ===================== */

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
  );
}

function normalizeParsedFields(parsed) {
  const out = { ...parsed };
  const rawLp = String(out.lpType || "").trim().toUpperCase();
  if (rawLp === "LP" || rawLp === "LPD") {
    out.lpType = rawLp;
  } else if (/\bLPD\b/i.test(out.shiftCode || "")) {
    out.lpType = "LPD";
  } else if (/\bLP\b/i.test(out.shiftCode || "")) {
    out.lpType = "LP";
  } else {
    out.lpType = "";
  }
  if (out.clientCategory) {
    out.clientCategory = String(out.clientCategory).trim().toUpperCase();
  }
  return out;
}

function buildShiftMessage(shift) {
  const date = shift.shiftDate || "";
  const time = `${shift.startTime || ""}-${shift.endTime || ""}`;
  const site = shift.siteName || shift.siteAddress || "the site";
  const code = shift.shiftCode ? ` (${shift.shiftCode})` : "";
  const role = shift.lpType ? `Role: ${shift.lpType}\n` : "";
  return (
    `The Investigators Group - shift coverage needed:\n` +
    `${date} ${time}\n` +
    `${role}` +
    `${site}${code}\n` +
    `Reply YES to accept or NO to pass.`
  );
}

async function sendSms(to, body) {
  if (!twilioConfigured()) {
    throw new Error(
      "Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to .env."
    );
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.message || `Twilio send failed (${resp.status}).`);
  }
  return { sid: data.sid, status: data.status };
}

function makeContact(guard) {
  return {
    guardId: guard.id || guard.guardId,
    guardName: guard.name || guard.guardName,
    phone: normalizePhone(guard.phone),
    status: "sent", // sent | yes | no | winner | lost | failed
    method: "sms", // sms | voice
    wave: 0,
    voiceCalled: false,
    error: "",
    sentAt: new Date().toISOString(),
    repliedAt: null,
  };
}

function addActivity(request, text) {
  request.activity = request.activity || [];
  request.activity.unshift({ at: new Date().toISOString(), text });
  if (request.activity.length > 50) request.activity.length = 50;
}

function logContact(contact, shift, method) {
  contactLog.unshift({
    id: randomUUID(),
    guardId: contact.guardId,
    guardName: contact.guardName,
    phone: contact.phone,
    shiftCode: shift.shiftCode || "",
    method,
    note: "",
    contactedAt: new Date().toISOString(),
  });
}

// Send the shift offer to one guard by SMS and register the reply mapping.
async function smsContact(request, guard, wave) {
  const contact = makeContact(guard);
  contact.method = "sms";
  contact.wave = wave || 1;
  if (!contact.phone) {
    contact.status = "failed";
    contact.error = "No phone number";
    request.contacts.push(contact);
    return contact;
  }
  try {
    await sendSms(contact.phone, buildShiftMessage(request.shift));
    phoneToContact.set(contact.phone, { requestId: request.id, guardId: contact.guardId });
    logContact(contact, request.shift, "SMS sent");
  } catch (err) {
    contact.status = "failed";
    contact.error = err.message;
    addActivity(request, `Text to ${contact.guardName} failed: ${err.message}`);
  }
  request.contacts.push(contact);
  return contact;
}

/* ===================== Twilio Voice (emergency escalation) ===================== */

function publicBaseUrl() {
  let url = String(process.env.PUBLIC_BASE_URL || "").trim();
  // Common Render mistake: pasting "PUBLIC_BASE_URL=https://..." as the value.
  url = url.replace(/^PUBLIC_BASE_URL=/i, "").replace(/^["']|["']$/g, "");
  return url.replace(/\/$/, "");
}

function voiceConfigured() {
  return twilioConfigured() && Boolean(publicBaseUrl());
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function voicePrompt(shift) {
  const date = shift.shiftDate || "";
  const time = `${shift.startTime || ""} to ${shift.endTime || ""}`;
  const site = shift.siteName || shift.siteAddress || "a client site";
  const role = shift.lpType ? `${shift.lpType} ` : "";
  return (
    `Hello, this is The Investigators Group with an urgent shift coverage request. ` +
    `We need a ${role}guard at ${site} on ${date}, from ${time}. ` +
    `To accept this shift, press 1. To decline, press 2.`
  );
}

// Place an outbound voice call; Twilio fetches TwiML from our /api/voice/outbound.
async function placeCall(to, requestId, guardId) {
  if (!voiceConfigured()) {
    throw new Error("Voice not configured (needs Twilio + PUBLIC_BASE_URL).");
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const twimlUrl = `${publicBaseUrl()}/api/voice/outbound?requestId=${encodeURIComponent(
    requestId
  )}&guardId=${encodeURIComponent(guardId)}`;

  const form = new URLSearchParams({ To: to, From: from, Url: twimlUrl, Method: "POST" });
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.message || `Twilio call failed (${resp.status}).`);
  }
  return { sid: data.sid, status: data.status };
}

async function voiceCallContact(request, contact) {
  if (!contact.phone) return;
  try {
    await placeCall(contact.phone, request.id, contact.guardId);
    contact.voiceCalled = true;
    addActivity(request, `Calling ${contact.guardName} (AI voice)...`);
    logContact(contact, request.shift, "Voice call");
  } catch (err) {
    addActivity(request, `Call to ${contact.guardName} failed: ${err.message}`);
  }
}

/* ===================== Shared accept / decline (first YES wins) ===================== */

async function acceptShift(request, guardId, via) {
  const contact = request.contacts.find((c) => c.guardId === guardId);
  if (!contact) return { result: "unknown" };
  contact.repliedAt = new Date().toISOString();

  if (request.status === "filled") {
    if (contact.status !== "winner") contact.status = "lost";
    addActivity(request, `${contact.guardName} accepted, but the shift was already filled.`);
    saveState();
    return { result: "late", contact };
  }

  request.status = "filled";
  request.winnerGuardId = guardId;
  contact.status = "winner";
  if (request.timer) {
    clearTimeout(request.timer);
    request.timer = null;
  }
  addActivity(request, `${contact.guardName} accepted via ${via}. Shift filled.`);

  for (const other of request.contacts) {
    if (other.guardId !== guardId && other.status === "sent") {
      other.status = "lost";
      if (other.phone) {
        sendSms(other.phone, "Thanks - this shift has now been filled.").catch(() => {});
      }
    }
  }
  logContact(contact, request.shift, `Accepted (${via})`);
  saveState();
  return { result: "winner", contact };
}

function declineShift(request, guardId, via) {
  const contact = request.contacts.find((c) => c.guardId === guardId);
  if (!contact) return { result: "unknown" };
  contact.repliedAt = new Date().toISOString();
  if (contact.status === "sent") contact.status = "no";
  addActivity(request, `${contact.guardName} declined via ${via}.`);
  saveState();
  return { result: "declined", contact };
}

/* ===================== Manual contact + Multi-wave agent ===================== */

const WAVE_SIZE = 3;
const WAVE_WAIT_MS = 45000; // fast cadence tuned for live demos

function newRequest(shift, mode) {
  const requestId = randomUUID();
  const request = {
    id: requestId,
    shift,
    status: "open", // open | filled
    mode, // manual | agent
    winnerGuardId: null,
    contacts: [],
    activity: [],
    queue: [],
    waveIndex: 0,
    voiceDone: false,
    timer: null,
    createdAt: new Date().toISOString(),
  };
  coverageRequests.set(requestId, request);
  return request;
}

// Manual: text the provided guards immediately, all at once.
async function createCoverageRequest(shift, guards) {
  const request = newRequest(shift, "manual");
  addActivity(request, `Manual outreach to ${guards.length} guard(s).`);
  for (const guard of guards) {
    await smsContact(request, guard, 1);
  }
  saveState();
  return request;
}

// Agent: escalating waves of SMS, then AI voice calls to non-responders.
async function startAgent(shift, guards) {
  const request = newRequest(shift, "agent");
  request.queue = [...guards];
  addActivity(request, `AI auto-fill started for ${guards.length} eligible guard(s).`);
  await runWave(request);
  saveState();
  return request;
}

async function runWave(request) {
  if (request.status === "filled") return;

  // Phase 1: SMS waves.
  if (request.queue.length > 0) {
    request.waveIndex += 1;
    const batch = request.queue.splice(0, WAVE_SIZE);
    addActivity(
      request,
      `Wave ${request.waveIndex}: texting ${batch.length} guard(s) (${batch
        .map((g) => g.name || g.guardName)
        .join(", ")}).`
    );
    for (const guard of batch) {
      await smsContact(request, guard, request.waveIndex);
    }
    saveState();
    request.timer = setTimeout(() => {
      runWave(request).catch((err) => console.error("Wave error:", err));
    }, WAVE_WAIT_MS);
    return;
  }

  // Phase 2: voice escalation for everyone still pending (once).
  if (!request.voiceDone) {
    request.voiceDone = true;
    const pending = request.contacts.filter((c) => c.status === "sent" && c.phone);
    if (voiceConfigured() && pending.length > 0) {
      addActivity(
        request,
        `No text replies yet. Escalating to AI voice calls for ${pending.length} guard(s).`
      );
      for (const contact of pending) {
        await voiceCallContact(request, contact);
      }
      saveState();
      request.timer = setTimeout(() => {
        runWave(request).catch((err) => console.error("Wave error:", err));
      }, WAVE_WAIT_MS);
      return;
    }
    if (!voiceConfigured() && pending.length > 0) {
      addActivity(request, "Voice escalation skipped (set PUBLIC_BASE_URL to enable calls).");
    }
  }

  if (request.status !== "filled") {
    addActivity(request, "All eligible guards contacted. Awaiting a response.");
    saveState();
  }
}

function publicRequestView(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    mode: request.mode || "manual",
    winnerGuardId: request.winnerGuardId,
    shift: request.shift,
    createdAt: request.createdAt,
    waveIndex: request.waveIndex || 0,
    pending: (request.queue || []).length,
    activity: request.activity || [],
    contacts: request.contacts.map((c) => ({
      guardId: c.guardId,
      guardName: c.guardName,
      phone: c.phone,
      status: c.status,
      method: c.method,
      wave: c.wave,
      voiceCalled: c.voiceCalled,
      error: c.error,
      sentAt: c.sentAt,
      repliedAt: c.repliedAt,
    })),
  };
}

function classifyReply(body) {
  const text = String(body || "").trim().toLowerCase();
  if (/^(y|yes|yep|yeah|accept|ok|okay)\b/.test(text)) return "yes";
  if (/^(n|no|nope|pass|decline)\b/.test(text)) return "no";
  return "unknown";
}

async function handleInboundSms(fromPhone, body) {
  const phone = normalizePhone(fromPhone);
  const mapping = phoneToContact.get(phone);
  if (!mapping) return "Thanks. No active shift request is linked to this number.";

  const request = coverageRequests.get(mapping.requestId);
  if (!request) return "Thanks. That shift request is no longer active.";

  const reply = classifyReply(body);

  if (reply === "no") {
    declineShift(request, mapping.guardId, "text");
    return "Thanks for letting us know. We'll find someone else.";
  }

  if (reply === "yes") {
    const { result } = await acceptShift(request, mapping.guardId, "text");
    if (result === "late") return "Thanks, but this shift has already been filled.";
    const s = request.shift;
    return `You're confirmed for ${s.siteName || "the shift"} on ${s.shiftDate} ${s.startTime}-${s.endTime}. See you there.`;
  }

  return "Please reply YES to accept this shift or NO to pass.";
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "shift-coverage-tool",
      mode: "zero-install",
    });
    return;
  }

  if (pathname === "/api/guards" && req.method === "GET") {
    sendJson(res, 200, { guards: await readJson("guards.json") });
    return;
  }

  if (pathname === "/api/schedule" && req.method === "GET") {
    const schedule = await readJson("schedule.json");
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get("date");
    const shifts = date ? schedule.filter((s) => s.shift_date === date) : schedule;
    sendJson(res, 200, { shifts });
    return;
  }

  if (pathname === "/api/parse-shift" && req.method === "POST") {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > 9 * 1024 * 1024) {
      req.destroy();
      sendJson(res, 413, { error: "Screenshot is too large. Upload an image under 8 MB." });
      return;
    }

    const body = await readJsonBody(req);
    const base64 = body.imageBase64;
    const mediaType = body.mediaType || "image/png";

    if (base64 && !["image/png", "image/jpeg", "image/webp"].includes(mediaType)) {
      sendJson(res, 400, { error: "Unsupported file type. Upload PNG, JPG, or WEBP." });
      return;
    }

    if (base64) {
      const parsed = normalizeParsedFields(await parseWithGemini(base64, mediaType));
      if (parsed) {
        const coords = await geocodeAddress(parsed.siteAddress);
        sendJson(res, 200, {
          parsedShift: {
            ...parsed,
            siteLat: coords?.lat ?? demoParsedShift.siteLat,
            siteLng: coords?.lng ?? demoParsedShift.siteLng,
            confidence: "gemini",
          },
          source: "gemini",
          message: "Parsed using Gemini Vision. Review the details before searching.",
        });
        return;
      }
    }

    sendJson(res, 200, {
      parsedShift: demoParsedShift,
      source: "demo-fallback",
      message:
        "GEMINI_API_KEY is not configured, so a demo parse was loaded. Add a key in .env for real screenshot reading.",
    });
    return;
  }

  if (pathname === "/api/coverage" && req.method === "POST") {
    const shift = await readJsonBody(req);
    const missing = ["shiftDate", "startTime", "endTime", "siteLat", "siteLng"].filter(
      (key) => shift[key] == null || shift[key] === ""
    );
    if (missing.length > 0) {
      sendJson(res, 400, { error: `Missing required field(s): ${missing.join(", ")}` });
      return;
    }

    const [guards, schedule] = await Promise.all([
      readJson("guards.json"),
      readJson("schedule.json"),
    ]);
    sendJson(res, 200, findAvailableGuards({ guards, schedule, shift }));
    return;
  }

  if (pathname === "/api/contact-log" && req.method === "GET") {
    sendJson(res, 200, { entries: contactLog });
    return;
  }

  if (pathname === "/api/contact-log" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.guardId || !body.guardName) {
      sendJson(res, 400, { error: "guardId and guardName are required." });
      return;
    }
    const entry = {
      id: randomUUID(),
      guardId: body.guardId,
      guardName: body.guardName,
      phone: body.phone || "",
      shiftCode: body.shiftCode || "",
      method: body.method || "manual call",
      note: body.note || "",
      contactedAt: new Date().toISOString(),
    };
    contactLog.unshift(entry);
    saveState();
    sendJson(res, 201, { entry });
    return;
  }

  if (pathname === "/api/sms/config" && req.method === "GET") {
    sendJson(res, 200, {
      configured: twilioConfigured(),
      from: process.env.TWILIO_PHONE_NUMBER || "",
      webhookReady: Boolean(process.env.PUBLIC_BASE_URL),
      voiceReady: voiceConfigured(),
    });
    return;
  }

  // Send to one or many guards. Body: { shift, guards: [...] }
  if (pathname === "/api/sms/contact" && req.method === "POST") {
    const body = await readJsonBody(req);
    const shift = body.shift || {};
    const guards = Array.isArray(body.guards)
      ? body.guards
      : body.guard
        ? [body.guard]
        : [];

    if (guards.length === 0) {
      sendJson(res, 400, { error: "Provide at least one guard to contact." });
      return;
    }
    if (!twilioConfigured()) {
      sendJson(res, 400, {
        error:
          "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env, then restart.",
      });
      return;
    }

    try {
      const request = await createCoverageRequest(shift, guards);
      sendJson(res, 201, { request: publicRequestView(request) });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === "/api/sms/request" && req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get("id");
    const request = coverageRequests.get(id);
    if (!request) {
      sendJson(res, 404, { error: "Coverage request not found." });
      return;
    }
    sendJson(res, 200, { request: publicRequestView(request) });
    return;
  }

  // Start the autonomous multi-wave fill agent. Body: { shift, guards: [...] }
  if (pathname === "/api/agent/start" && req.method === "POST") {
    const body = await readJsonBody(req);
    const shift = body.shift || {};
    const guards = Array.isArray(body.guards) ? body.guards : [];
    if (guards.length === 0) {
      sendJson(res, 400, { error: "No eligible guards to contact." });
      return;
    }
    if (!twilioConfigured()) {
      sendJson(res, 400, {
        error:
          "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env, then restart.",
      });
      return;
    }
    try {
      const request = await startAgent(shift, guards);
      sendJson(res, 201, { request: publicRequestView(request) });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // Manually trigger a single AI voice call. Body: { requestId, guardId }
  if (pathname === "/api/voice/call" && req.method === "POST") {
    const body = await readJsonBody(req);
    const request = coverageRequests.get(body.requestId);
    if (!request) {
      sendJson(res, 404, { error: "Coverage request not found." });
      return;
    }
    if (!voiceConfigured()) {
      sendJson(res, 400, {
        error: "Voice calls need Twilio + a public PUBLIC_BASE_URL. Deploy or tunnel first.",
      });
      return;
    }
    const contact = request.contacts.find((c) => c.guardId === body.guardId);
    if (!contact) {
      sendJson(res, 404, { error: "That guard is not part of this request." });
      return;
    }
    await voiceCallContact(request, contact);
    saveState();
    sendJson(res, 200, { request: publicRequestView(request) });
    return;
  }

  // Twilio Voice: TwiML played when the guard answers. Keypad capture.
  if (pathname === "/api/voice/outbound" && (req.method === "POST" || req.method === "GET")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestId = url.searchParams.get("requestId") || "";
    const guardId = url.searchParams.get("guardId") || "";
    const request = coverageRequests.get(requestId);
    const prompt = request ? voicePrompt(request.shift) : "This shift is no longer available.";
    const action = `${publicBaseUrl()}/api/voice/gather?requestId=${encodeURIComponent(
      requestId
    )}&guardId=${encodeURIComponent(guardId)}`;

    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response>` +
        `<Gather numDigits="1" timeout="8" action="${xmlEscape(action)}" method="POST">` +
        `<Say voice="alice">${xmlEscape(prompt)}</Say>` +
        `</Gather>` +
        `<Say voice="alice">We did not receive a response. Goodbye.</Say>` +
        `</Response>`
    );
    return;
  }

  // Twilio Voice: handles the digit the guard pressed.
  if (pathname === "/api/voice/gather" && req.method === "POST") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestId = url.searchParams.get("requestId") || "";
    const guardId = url.searchParams.get("guardId") || "";
    const form = await readFormBody(req);
    const digit = String(form.Digits || "").trim();
    const request = coverageRequests.get(requestId);

    let say = "Thanks. Goodbye.";
    if (request) {
      if (digit === "1") {
        const { result } = await acceptShift(request, guardId, "voice");
        const s = request.shift;
        say =
          result === "late"
            ? "Thanks, but this shift has already been filled. Goodbye."
            : `You are confirmed for the shift on ${s.shiftDate} from ${s.startTime} to ${s.endTime}. Thank you. Goodbye.`;
      } else if (digit === "2") {
        declineShift(request, guardId, "voice");
        say = "Thanks for letting us know. Goodbye.";
      } else {
        say = "Sorry, we did not understand that. Goodbye.";
      }
    }

    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${xmlEscape(
        say
      )}</Say></Response>`
    );
    return;
  }

  // Twilio inbound webhook (replies). Responds with TwiML.
  if (pathname === "/api/sms/inbound" && req.method === "POST") {
    const form = await readFormBody(req);
    let reply = "Thanks for your reply.";
    try {
      reply = await handleInboundSms(form.From, form.Body);
    } catch (err) {
      console.error("Inbound SMS error:", err);
    }
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    );
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(PUBLIC_DIR, safePath);
  const ext = extname(filePath);
  const contentType = contentTypes[ext] || "application/octet-stream";

  try {
    await readFile(filePath);
    res.writeHead(200, { "content-type": contentType });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(join(PUBLIC_DIR, "index.html")).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || "Something went wrong." });
  }
});

server.listen(PORT, () => {
  console.log(`Shift Coverage Tool running at http://localhost:${PORT}`);
});
