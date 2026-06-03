const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

export function parseShiftScreenshot(file) {
  const body = new FormData();
  body.append("screenshot", file);

  return request("/parse-shift", {
    method: "POST",
    body,
  });
}

export function findCoverage(shift) {
  return request("/coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(shift),
  });
}

export function getContactLog() {
  return request("/contact-log");
}

export function addContactLog(entry) {
  return request("/contact-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  });
}
