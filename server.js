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
      coverageRequests: [...coverageRequests.values()],
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
  siteName: "Union Station",
  siteAddress: "65 Front St W, Toronto, ON",
  siteLat: 43.6453,
  siteLng: -79.3806,
  shiftCode: "Metro 235 (TT)",
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
                "siteName, siteAddress, shiftCode, notes. Use an empty string for anything not visible.",
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

function findAvailableGuards({ guards, schedule, shift }) {
  const radiusKm = Number(shift.radiusKm || 10);
  const activeGuards = guards.filter((g) => g.status === "active");
  const shiftsToday = schedule.filter((s) => s.shift_date === shift.shiftDate);
  const available = [];
  const availableOutOfRadius = [];
  const busy = [];

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

    const enriched = {
      ...guard,
      certificationsList: String(guard.certifications || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      distanceKm,
      withinRadius: distanceKm == null || distanceKm <= radiusKm,
    };

    if (conflicts.length > 0) {
      busy.push({ ...enriched, busyWith: conflicts });
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

  return {
    shift,
    available,
    availableOutOfRadius,
    busy,
    counts: {
      available: available.length,
      outOfRadius: availableOutOfRadius.length,
      busy: busy.length,
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

function buildShiftMessage(shift) {
  const date = shift.shiftDate || "";
  const time = `${shift.startTime || ""}-${shift.endTime || ""}`;
  const site = shift.siteName || shift.siteAddress || "the site";
  const code = shift.shiftCode ? ` (${shift.shiftCode})` : "";
  return (
    `The Investigators Group - shift coverage needed:\n` +
    `${date} ${time}\n` +
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
    error: "",
    sentAt: new Date().toISOString(),
    repliedAt: null,
  };
}

async function createCoverageRequest(shift, guards) {
  const requestId = randomUUID();
  const request = {
    id: requestId,
    shift,
    status: "open", // open | filled | closed
    winnerGuardId: null,
    contacts: [],
    createdAt: new Date().toISOString(),
  };

  for (const guard of guards) {
    const contact = makeContact(guard);
    if (!contact.phone) {
      contact.status = "failed";
      contact.error = "No phone number";
      request.contacts.push(contact);
      continue;
    }
    try {
      await sendSms(contact.phone, buildShiftMessage(shift));
      phoneToContact.set(contact.phone, { requestId, guardId: contact.guardId });
      contactLog.unshift({
        id: randomUUID(),
        guardId: contact.guardId,
        guardName: contact.guardName,
        phone: contact.phone,
        shiftCode: shift.shiftCode || "",
        method: "SMS sent",
        note: "",
        contactedAt: contact.sentAt,
      });
    } catch (err) {
      contact.status = "failed";
      contact.error = err.message;
    }
    request.contacts.push(contact);
  }

  coverageRequests.set(requestId, request);
  saveState();
  return request;
}

function publicRequestView(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    winnerGuardId: request.winnerGuardId,
    shift: request.shift,
    createdAt: request.createdAt,
    contacts: request.contacts.map((c) => ({
      guardId: c.guardId,
      guardName: c.guardName,
      phone: c.phone,
      status: c.status,
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

  const contact = request.contacts.find((c) => c.guardId === mapping.guardId);
  if (!contact) return "Thanks for your reply.";

  const reply = classifyReply(body);
  contact.repliedAt = new Date().toISOString();

  if (reply === "no") {
    contact.status = "no";
    saveState();
    return "Thanks for letting us know. We'll find someone else.";
  }

  if (reply === "yes") {
    if (request.status === "filled") {
      contact.status = "lost";
      saveState();
      return "Thanks, but this shift has already been filled.";
    }
    request.status = "filled";
    request.winnerGuardId = contact.guardId;
    contact.status = "winner";
    for (const other of request.contacts) {
      if (other.guardId !== contact.guardId && other.status === "sent") {
        other.status = "lost";
        try {
          await sendSms(other.phone, "Thanks - this shift has now been filled.");
        } catch {
          /* ignore */
        }
      }
    }
    saveState();
    const s = request.shift;
    return `You're confirmed for ${s.siteName || "the shift"} on ${s.shiftDate} ${s.startTime}-${s.endTime}. See you there.`;
  }

  saveState();
  return 'Please reply YES to accept this shift or NO to pass.';
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
      const parsed = await parseWithGemini(base64, mediaType);
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
