import { History } from "lucide-react";

export default function ContactLog({ entries }) {
  return (
    <section className="glass rounded-3xl p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <History size={21} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-950">Contact log</h2>
          <p className="text-sm text-slate-600">Manual calls tracked for the demo.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {entries.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            No guards contacted yet.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-950">{entry.guardName}</p>
                  <p className="text-sm text-slate-500">{entry.phone}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {entry.method}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {new Date(entry.contactedAt).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
