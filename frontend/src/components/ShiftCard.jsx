import { CalendarDays, Clock, MapPin, Radar } from "lucide-react";

const torontoSites = [
  {
    label: "Union Station",
    siteName: "Union Station",
    siteAddress: "65 Front St W, Toronto, ON",
    siteLat: 43.6453,
    siteLng: -79.3806,
  },
  {
    label: "Eaton Centre",
    siteName: "Eaton Centre",
    siteAddress: "220 Yonge St, Toronto, ON",
    siteLat: 43.6544,
    siteLng: -79.3807,
  },
  {
    label: "Square One",
    siteName: "Square One",
    siteAddress: "100 City Centre Dr, Mississauga, ON",
    siteLat: 43.5931,
    siteLng: -79.6425,
  },
  {
    label: "Yorkdale Mall",
    siteName: "Yorkdale Mall",
    siteAddress: "3401 Dufferin St, North York, ON",
    siteLat: 43.7256,
    siteLng: -79.4524,
  },
];

function Field({ icon: Icon, label, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon size={15} />
        {label}
      </span>
      {children}
    </label>
  );
}

export default function ShiftCard({ shift, setShift, onFind, loading }) {
  const update = (patch) => setShift((prev) => ({ ...prev, ...patch }));

  return (
    <section className="glass rounded-3xl p-6 shadow-soft">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">
          Step 2
        </p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">
          Confirm shift details
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Adjust anything the AI missed, then run availability.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field icon={CalendarDays} label="Date">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            type="date"
            value={shift.shiftDate || ""}
            onChange={(e) => update({ shiftDate: e.target.value })}
          />
        </Field>

        <Field icon={Radar} label="Radius">
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            value={shift.radiusKm || 10}
            onChange={(e) => update({ radiusKm: Number(e.target.value) })}
          >
            {[5, 10, 15, 25, 50].map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </select>
        </Field>

        <Field icon={Clock} label="Start">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            type="time"
            value={shift.startTime || ""}
            onChange={(e) => update({ startTime: e.target.value })}
          />
        </Field>

        <Field icon={Clock} label="End">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            type="time"
            value={shift.endTime || ""}
            onChange={(e) => update({ endTime: e.target.value })}
          />
        </Field>

        <Field icon={MapPin} label="Known site quick-fill">
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            defaultValue=""
            onChange={(e) => {
              const selected = torontoSites.find((site) => site.label === e.target.value);
              if (selected) update(selected);
            }}
          >
            <option value="">Select a known site...</option>
            {torontoSites.map((site) => (
              <option key={site.label} value={site.label}>
                {site.label}
              </option>
            ))}
          </select>
        </Field>

        <Field icon={MapPin} label="Shift code">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
            value={shift.shiftCode || ""}
            placeholder="Metro 235 (TT)"
            onChange={(e) => update({ shiftCode: e.target.value })}
          />
        </Field>

        <div className="md:col-span-2">
          <Field icon={MapPin} label="Site name">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
              value={shift.siteName || ""}
              placeholder="Union Station"
              onChange={(e) => update({ siteName: e.target.value })}
            />
          </Field>
        </div>

        <div className="md:col-span-2">
          <Field icon={MapPin} label="Site address">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-500"
              value={shift.siteAddress || ""}
              placeholder="65 Front St W, Toronto, ON"
              onChange={(e) => update({ siteAddress: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <button
        className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-4 font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onFind}
        disabled={loading}
      >
        {loading ? "Finding available guards..." : "Find Available Guards"}
      </button>
    </section>
  );
}
