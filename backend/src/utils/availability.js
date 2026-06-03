import { distanceToSiteKm } from "./distance.js";

/** Convert "HH:MM" to minutes since midnight. */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Do two shifts overlap in time? Handles overnight shifts (end < start)
 * by treating them as spanning into the next day.
 */
export function shiftsOverlap(aStart, aEnd, bStart, bEnd) {
  let a1 = toMinutes(aStart);
  let a2 = toMinutes(aEnd);
  let b1 = toMinutes(bStart);
  let b2 = toMinutes(bEnd);

  if (a2 <= a1) a2 += 24 * 60; // overnight
  if (b2 <= b1) b2 += 24 * 60; // overnight

  return a1 < b2 && b1 < a2;
}

/**
 * Core algorithm from the brief.
 * Returns guards split into available / busy, distance-filtered and sorted.
 */
export function findAvailableGuards({
  guards,
  schedule,
  shiftDate,
  startTime,
  endTime,
  site,
  radiusKm,
}) {
  const activeGuards = guards.filter((g) => g.status === "active");
  const shiftsToday = schedule.filter((s) => s.shift_date === shiftDate);

  const available = [];
  const busy = [];

  for (const guard of activeGuards) {
    const conflicts = shiftsToday.filter(
      (s) =>
        s.guard_id === guard.id &&
        shiftsOverlap(startTime, endTime, s.start_time, s.end_time)
    );

    const distanceKm = distanceToSiteKm(guard, site);
    const withinRadius =
      radiusKm == null || distanceKm == null || distanceKm <= radiusKm;

    const enriched = {
      ...guard,
      certificationsList: String(guard.certifications || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
      withinRadius,
    };

    if (conflicts.length > 0) {
      busy.push({ ...enriched, busyWith: conflicts });
    } else if (withinRadius) {
      available.push(enriched);
    } else {
      // Available but outside the radius — kept separately so the UI can
      // still surface them if the supervisor widens the search.
      available.push({ ...enriched });
    }
  }

  const sortByDistance = (a, b) => {
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  };

  const availableInRadius = available
    .filter((g) => g.withinRadius)
    .sort(sortByDistance);
  const availableOutOfRadius = available
    .filter((g) => !g.withinRadius)
    .sort(sortByDistance);

  return {
    available: availableInRadius,
    availableOutOfRadius,
    busy: busy.sort(sortByDistance),
    counts: {
      available: availableInRadius.length,
      outOfRadius: availableOutOfRadius.length,
      busy: busy.length,
      totalActive: activeGuards.length,
    },
  };
}
