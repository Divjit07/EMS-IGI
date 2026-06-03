const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

const sites = {
  union: {
    siteName: "Union Station",
    siteAddress: "65 Front St W, Toronto, ON",
    siteLat: 43.6453,
    siteLng: -79.3806,
  },
  eaton: {
    siteName: "Eaton Centre",
    siteAddress: "220 Yonge St, Toronto, ON",
    siteLat: 43.6544,
    siteLng: -79.3807,
  },
  "square-one": {
    siteName: "Square One",
    siteAddress: "100 City Centre Dr, Mississauga, ON",
    siteLat: 43.5931,
    siteLng: -79.6425,
  },
  yorkdale: {
    siteName: "Yorkdale Mall",
    siteAddress: "3401 Dufferin St, North York, ON",
    siteLat: 43.7256,
    siteLng: -79.4524,
  },
};

const avatarPalette = [
  ["#8a2b2e", "#732226"],
  ["#3a4a63", "#27324a"],
  ["#1f7a4d", "#155f3b"],
  ["#7a5a1f", "#5e4516"],
  ["#5c4a82", "#473a66"],
  ["#2f6b80", "#234f60"],
];

let currentShift = {
  shiftDate: "2026-06-03",
  startTime: "15:00",
  endTime: "23:00",
  siteName: "Union Station",
  siteAddress: "65 Front St W, Toronto, ON",
  siteLat: 43.6453,
  siteLng: -79.3806,
  shiftCode: "Metro 235 (TT)",
  radiusKm: 10,
};

const contactedIds = new Set();
let lastResult = null;
let activeRequestId = null;
let pollTimer = null;
let smsConfigured = false;
const $ = (id) => document.getElementById(id);

const fields = {
  shiftDate: $("shiftDate"),
  startTime: $("startTime"),
  endTime: $("endTime"),
  siteName: $("siteName"),
  siteAddress: $("siteAddress"),
  shiftCode: $("shiftCode"),
};

let toastTimer;
function toast(message, isError = true) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  el.style.borderColor = isError ? "" : "var(--green-bg)";
  el.style.background = isError ? "" : "var(--green-bg)";
  el.style.color = isError ? "" : "var(--green)";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 5200);
}

function clearToast() {
  $("toast").classList.add("hidden");
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function avatarColors(id) {
  const index = Math.abs(hashCode(id)) % avatarPalette.length;
  return avatarPalette[index];
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash = (hash << 5) - hash + String(value).charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- form sync ---------- */
function populateForm() {
  for (const [key, input] of Object.entries(fields)) {
    input.value = currentShift[key] ?? "";
  }
  document.querySelectorAll("#radiusGroup button").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.radius) === Number(currentShift.radiusKm));
  });
}

function readForm() {
  currentShift = {
    ...currentShift,
    shiftDate: fields.shiftDate.value,
    startTime: fields.startTime.value,
    endTime: fields.endTime.value,
    siteName: fields.siteName.value,
    siteAddress: fields.siteAddress.value,
    shiftCode: fields.shiftCode.value,
  };
}

/* ---------- upload ---------- */
function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported file type. Please upload a PNG, JPG, or WEBP image.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "That image is larger than 8 MB. Please upload a smaller screenshot.";
  }
  return null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the uploaded image."));
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  clearToast();
  const validationError = validateFile(file);
  if (validationError) {
    toast(validationError);
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  const imageBase64 = dataUrl.split(",")[1];

  try {
    $("previewImg").src = dataUrl;
    $("previewName").textContent = file.name;
    $("dropzoneInner").classList.add("hidden");
    $("dropPreview").classList.remove("hidden");

    const data = await request("/api/parse-shift", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mediaType: file.type,
        imageBase64,
      }),
    });
    if (data.parsedShift) {
      currentShift = { ...currentShift, ...data.parsedShift };
      populateForm();
    }
    const notice = $("parseNotice");
    notice.textContent =
      data.source === "gemini"
        ? "Parsed with Gemini. Review the extracted details below."
        : "Demo parse loaded because the Gemini API key is not connected yet. Review and edit the details below.";
    notice.classList.remove("hidden");
  } catch (err) {
    toast(err.message);
  }
}

function resetUpload() {
  $("fileInput").value = "";
  $("dropPreview").classList.add("hidden");
  $("dropzoneInner").classList.remove("hidden");
  $("parseNotice").classList.add("hidden");
}

/* ---------- rendering ---------- */
function guardCard(guard, variant) {
  const [c1, c2] = avatarColors(guard.id);
  const busy = variant === "busy";
  const certs = (guard.certificationsList || [])
    .map((cert) => `<span class="cert">${escapeHtml(cert)}</span>`)
    .join("");

  const distance =
    guard.distanceKm == null
      ? "Distance n/a"
      : `${guard.distanceKm} km`;

  const busyNote =
    busy && guard.busyWith?.length
      ? `<div class="busyNote">On shift ${guard.busyWith[0].start_time}–${guard.busyWith[0].end_time} · ${escapeHtml(guard.busyWith[0].site_name)}</div>`
      : "";

  const isDone = contactedIds.has(guard.id);
  const action = busy
    ? ""
    : `<button class="contactBtn ${isDone ? "done" : ""}" data-contact="${guard.id}" ${isDone ? "disabled" : ""}>
         ${
           isDone
             ? "Texted"
             : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H5.17L4 17.17V4z"/><path d="M8 9h8M8 13h5"/></svg> Text`
         }
       </button>`;

  return `
    <article class="guard">
      <div class="guardAvatar" style="background:linear-gradient(135deg, ${c1}, ${c2});">${escapeHtml(initials(guard.name))}</div>
      <div class="guardMain">
        <div class="guardNameRow">
          <span class="guardName">${escapeHtml(guard.name)}</span>
          <span class="distanceTag">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${distance}
          </span>
        </div>
        <div class="guardMeta">${escapeHtml(guard.phone)}</div>
        <div class="certs">${certs}</div>
        ${busyNote}
      </div>
      ${action}
    </article>
  `;
}

function kpi(value, label, tone) {
  return `<div class="kpi kpi--${tone}"><b>${value}</b><span>${label}</span></div>`;
}

function renderResults(result) {
  lastResult = result;
  $("resultsEmpty").classList.add("hidden");
  $("resultsContent").classList.remove("hidden");
  $("kpiRow").classList.remove("hidden");

  const s = result.shift;
  $("shiftSummary").classList.remove("hidden");
  $("shiftSummary").innerHTML = `
    <strong>${escapeHtml(s.siteName || "Shift")}</strong><br />
    ${escapeHtml(s.shiftDate)} · ${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)} · within ${escapeHtml(String(s.radiusKm))} km
  `;

  $("kpiRow").innerHTML = [
    kpi(result.counts.available, "Available", "green"),
    kpi(result.counts.busy, "On shift", "red"),
    kpi(result.counts.outOfRadius, "Out of range", "amber"),
    kpi(result.counts.totalActive, "Active roster", "slate"),
  ].join("");

  $("availableCount").textContent = result.counts.available;
  $("busyCount").textContent = result.counts.busy;
  $("outCount").textContent = result.counts.outOfRadius;

  $("availableList").innerHTML = result.available.length
    ? result.available.map((g) => guardCard(g, "available")).join("")
    : `<div class="timelineEmpty">No available guards within ${escapeHtml(String(s.radiusKm))} km. Widen the radius to see more.</div>`;

  $("busyList").innerHTML = result.busy.map((g) => guardCard(g, "busy")).join("");
  $("outList").innerHTML = (result.availableOutOfRadius || [])
    .map((g) => guardCard(g, "out"))
    .join("");

  $("busyBlock").classList.toggle("hidden", result.busy.length === 0);
  $("outOfRangeBlock").classList.toggle("hidden", (result.availableOutOfRadius || []).length === 0);

  const contactAllBtn = $("contactAllBtn");
  contactAllBtn.disabled = result.available.length === 0;

  bindContactButtons(result);
}

function bindContactButtons(result) {
  const pool = [...result.available, ...(result.availableOutOfRadius || [])];
  document.querySelectorAll("[data-contact]").forEach((button) => {
    button.addEventListener("click", async () => {
      const guard = pool.find((item) => item.id === button.dataset.contact);
      if (guard) await contactGuard(guard, button);
    });
  });
}

function renderLog(entries = []) {
  const target = $("contactLog");
  if (!entries.length) {
    target.innerHTML = `<div class="timelineEmpty">No outreach logged yet.</div>`;
    return;
  }
  target.innerHTML = entries
    .map((entry) => {
      const [c1, c2] = avatarColors(entry.guardId);
      return `
        <div class="logEntry">
          <div class="logAvatar" style="background:linear-gradient(135deg, ${c1}, ${c2}); color:#fff;">${escapeHtml(initials(entry.guardName))}</div>
          <div class="logBody">
            <strong>${escapeHtml(entry.guardName)}</strong>
            <span>${escapeHtml(entry.phone || "")} · ${new Date(entry.contactedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <span class="logTag">${escapeHtml(entry.method || "contacted")}</span>
        </div>
      `;
    })
    .join("");
}

async function contactGuard(guard, button) {
  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }
  await sendSmsToGuards([guard]);
}

function guardForSms(g) {
  return { id: g.id, name: g.name, phone: g.phone };
}

async function sendSmsToGuards(guards) {
  clearToast();
  if (!guards || guards.length === 0) return;

  try {
    const data = await request("/api/sms/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shift: currentShift,
        guards: guards.map(guardForSms),
      }),
    });

    activeRequestId = data.request.id;
    guards.forEach((g) => contactedIds.add(g.id));
    if (lastResult) renderResults(lastResult);

    renderSmsStatus(data.request);
    startPolling();

    const sent = data.request.contacts.filter((c) => c.status !== "failed").length;
    toast(`Text sent to ${sent} guard${sent === 1 ? "" : "s"}.`, false);

    const log = await request("/api/contact-log");
    renderLog(log.entries || []);
  } catch (err) {
    toast(err.message);
    if (lastResult) renderResults(lastResult);
  }
}

function smsContactRow(contact) {
  const [c1, c2] = avatarColors(contact.guardId);
  const labels = {
    sent: "awaiting reply",
    winner: "accepted ✓",
    yes: "accepted",
    no: "declined",
    lost: "filled by other",
    failed: contact.error || "failed",
  };
  return `
    <div class="smsContactRow">
      <div class="logAvatar" style="width:28px;height:28px;font-size:11px;background:linear-gradient(135deg, ${c1}, ${c2}); color:#fff;">${escapeHtml(initials(contact.guardName))}</div>
      <span class="smsContactName">${escapeHtml(contact.guardName)}</span>
      <span class="smsContactPhone">${escapeHtml(contact.phone)}</span>
      <span class="smsPill smsPill--${contact.status}">${escapeHtml(labels[contact.status] || contact.status)}</span>
    </div>
  `;
}

function renderSmsStatus(reqView) {
  const el = $("smsStatus");
  el.classList.remove("hidden");
  const filled = reqView.status === "filled";
  const winner = filled
    ? reqView.contacts.find((c) => c.guardId === reqView.winnerGuardId)
    : null;

  el.innerHTML = `
    <div class="smsStatusHead">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H5.17L4 17.17V4z"/></svg>
      <h4>SMS coverage request</h4>
      <span class="smsBadge smsBadge--${filled ? "filled" : "open"}">${filled ? "Filled" : "Awaiting replies"}</span>
    </div>
    ${reqView.contacts.map(smsContactRow).join("")}
    ${
      winner
        ? `<p class="smsHint">✅ <strong>${escapeHtml(winner.guardName)}</strong> accepted first and is confirmed for the shift.</p>`
        : `<p class="smsHint">Guards reply YES/NO by text. First YES wins. ${
            smsConfigured
              ? "Replies update here automatically when the inbound webhook is connected."
              : ""
          }</p>`
    }
  `;
}

function startPolling() {
  stopPolling();
  if (!activeRequestId) return;
  let ticks = 0;
  pollTimer = setInterval(async () => {
    ticks += 1;
    if (ticks > 60 || !activeRequestId) {
      stopPolling();
      return;
    }
    try {
      const data = await request(`/api/sms/request?id=${encodeURIComponent(activeRequestId)}`);
      renderSmsStatus(data.request);
      if (data.request.status === "filled") stopPolling();
    } catch {
      stopPolling();
    }
  }, 4000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function findCoverage() {
  readForm();
  clearToast();
  const btn = $("findBtn");
  const label = btn.querySelector(".btnLabel");
  const spinner = btn.querySelector(".btnSpinner");

  btn.disabled = true;
  label.textContent = "Searching roster…";
  spinner.classList.remove("hidden");

  try {
    const result = await request("/api/coverage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentShift),
    });
    renderResults(result);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    label.textContent = "Find available guards";
    spinner.classList.add("hidden");
  }
}

/* ---------- clock ---------- */
function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- init ---------- */
async function init() {
  populateForm();
  tickClock();
  setInterval(tickClock, 30000);

  Object.values(fields).forEach((field) => {
    field.addEventListener("input", readForm);
    field.addEventListener("change", readForm);
  });

  $("knownSite").addEventListener("change", (event) => {
    const site = sites[event.target.value];
    if (!site) return;
    currentShift = { ...currentShift, ...site };
    populateForm();
  });

  document.querySelectorAll("#radiusGroup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#radiusGroup button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentShift.radiusKm = Number(btn.dataset.radius);
    });
  });

  const dropzone = $("dropzone");
  $("fileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  $("clearPreview").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetUpload();
  });

  $("findBtn").addEventListener("click", findCoverage);

  $("contactAllBtn").addEventListener("click", async () => {
    if (!lastResult || lastResult.available.length === 0) return;
    const btn = $("contactAllBtn");
    btn.disabled = true;
    await sendSmsToGuards(lastResult.available);
    btn.disabled = false;
  });

  try {
    const [log, guards, schedule, sms] = await Promise.all([
      request("/api/contact-log"),
      request("/api/guards"),
      request("/api/schedule?date=2026-06-03"),
      request("/api/sms/config").catch(() => ({ configured: false })),
    ]);
    renderLog(log.entries || []);
    $("rosterCount").textContent = (guards.guards || []).filter((g) => g.status === "active").length;
    $("shiftCount").textContent = (schedule.shifts || []).length;
    smsConfigured = Boolean(sms.configured);
  } catch (err) {
    toast(err.message);
  }
}

init().catch((err) => toast(err.message));
