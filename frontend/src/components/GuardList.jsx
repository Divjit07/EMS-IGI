import { BadgeCheck, MapPinned, Phone, ShieldCheck, UserX } from "lucide-react";

function GuardCard({ guard, busy, onContact }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-950">{guard.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{guard.phone}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            busy ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {busy ? "Busy" : "Available"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(guard.certificationsList || []).map((cert) => (
          <span
            key={cert}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
          >
            <ShieldCheck size={13} />
            {cert}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <MapPinned size={16} />
        <span>
          {guard.distanceKm == null ? "Distance unavailable" : `${guard.distanceKm} km away`}
        </span>
      </div>

      {busy && guard.busyWith?.length > 0 && (
        <div className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-800">
          Working {guard.busyWith[0].start_time}–{guard.busyWith[0].end_time} at{" "}
          {guard.busyWith[0].site_name}
        </div>
      )}

      {!busy && (
        <button
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700"
          onClick={() => onContact(guard)}
        >
          <Phone size={17} />
          Contact / Log Call
        </button>
      )}
    </article>
  );
}

export default function GuardList({ result, onContact }) {
  if (!result) {
    return (
      <section className="glass rounded-3xl p-6 text-center shadow-soft">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <BadgeCheck size={28} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-950">
          Results will appear here
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Upload a shift screenshot or enter details manually, then run the
          availability check.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="glass rounded-3xl p-6 shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-purple-600">
          Step 3
        </p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">
          Coverage candidates
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Stat label="Available" value={result.counts.available} tone="emerald" />
          <Stat label="Busy" value={result.counts.busy} tone="rose" />
          <Stat label="Outside radius" value={result.counts.outOfRadius} tone="amber" />
          <Stat label="Active roster" value={result.counts.totalActive} tone="slate" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {result.available.map((guard) => (
          <GuardCard key={guard.id} guard={guard} onContact={onContact} />
        ))}
      </div>

      {result.available.length === 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          No available guards inside this radius. Try widening the search.
        </div>
      )}

      {result.busy.length > 0 && (
        <details className="rounded-3xl border border-slate-200 bg-white p-5">
          <summary className="flex cursor-pointer items-center gap-2 font-bold text-slate-900">
            <UserX size={18} />
            Busy guards for reference
          </summary>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {result.busy.map((guard) => (
              <GuardCard key={guard.id} guard={guard} busy onContact={onContact} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <div className={`rounded-2xl p-4 ${tones[tone]}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
    </div>
  );
}
