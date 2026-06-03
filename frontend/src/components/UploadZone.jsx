import { ImageUp, Loader2, Sparkles } from "lucide-react";

export default function UploadZone({ onFile, loading, parseSource }) {
  return (
    <section className="glass rounded-3xl p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
            Step 1
          </p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">
            Upload shift screenshot
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Drop in a WhatsApp, TrackTik, or group-chat screenshot. If your
            Claude key is set, the backend will parse it automatically.
          </p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
          <Sparkles size={24} />
        </div>
      </div>

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center transition hover:border-blue-400 hover:bg-blue-50">
        {loading ? (
          <Loader2 className="animate-spin text-blue-600" size={36} />
        ) : (
          <ImageUp className="text-slate-500" size={40} />
        )}
        <span className="mt-4 text-base font-semibold text-slate-900">
          {loading ? "Parsing screenshot..." : "Choose screenshot"}
        </span>
        <span className="mt-1 text-sm text-slate-500">
          PNG, JPG, or WEBP up to 8 MB
        </span>
        <input
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>

      {parseSource && (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Parse source: <span className="font-semibold">{parseSource}</span>.
          You can edit the extracted fields below before finding guards.
        </p>
      )}
    </section>
  );
}
