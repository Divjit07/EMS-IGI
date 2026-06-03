import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Clock3 } from "lucide-react";
import UploadZone from "./components/UploadZone.jsx";
import ShiftCard from "./components/ShiftCard.jsx";
import GuardList from "./components/GuardList.jsx";
import ContactLog from "./components/ContactLog.jsx";
import {
  addContactLog,
  findCoverage,
  getContactLog,
  parseShiftScreenshot,
} from "./api/client.js";

const initialShift = {
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

export default function App() {
  const [shift, setShift] = useState(initialShift);
  const [coverage, setCoverage] = useState(null);
  const [contactLog, setContactLog] = useState([]);
  const [parseSource, setParseSource] = useState("");
  const [loadingParse, setLoadingParse] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getContactLog()
      .then((data) => setContactLog(data.entries || []))
      .catch(() => {});
  }, []);

  const completeness = useMemo(() => {
    const required = ["shiftDate", "startTime", "endTime", "siteLat", "siteLng"];
    return required.every((key) => shift[key] !== "" && shift[key] != null);
  }, [shift]);

  async function handleFile(file) {
    setLoadingParse(true);
    setError("");
    try {
      const data = await parseShiftScreenshot(file);
      setParseSource(data.source);
      setShift((prev) => ({
        ...prev,
        ...data.parsedShift,
        radiusKm: prev.radiusKm || 10,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingParse(false);
    }
  }

  async function handleFindCoverage() {
    setLoadingCoverage(true);
    setError("");
    try {
      const data = await findCoverage(shift);
      setCoverage(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingCoverage(false);
    }
  }

  async function handleContact(guard) {
    setError("");
    try {
      const data = await addContactLog({
        guardId: guard.id,
        guardName: guard.name,
        phone: guard.phone,
        shiftCode: shift.shiftCode,
      });
      setContactLog((prev) => [data.entry, ...prev]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_32%),radial-gradient(circle_at_top_right,#dcfce7,transparent_28%),#f8fafc]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 overflow-hidden rounded-[2rem] bg-slate-950 p-8 text-white shadow-soft">
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-blue-100">
                <Building2 size={16} />
                Emergency Shift Coverage Tool
              </div>
              <h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
                Fill open security shifts in under 2 minutes.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
                Upload a shift screenshot, confirm the extracted details, and
                instantly see guards who are nearby and not already working.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Metric icon={Clock3} label="Current process" value="30–60 min" />
              <Metric icon={CheckCircle2} label="MVP target" value="< 2 min" />
              <Metric icon={AlertTriangle} label="Phase 1 cost" value="~$0" />
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-3xl border border-rose-200 bg-rose-50 p-4 font-medium text-rose-800">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <UploadZone
              onFile={handleFile}
              loading={loadingParse}
              parseSource={parseSource}
            />
            <ShiftCard
              shift={shift}
              setShift={setShift}
              onFind={handleFindCoverage}
              loading={loadingCoverage || !completeness}
            />
            <ContactLog entries={contactLog} />
          </div>

          <GuardList result={coverage} onContact={handleContact} />
        </div>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-3xl bg-white/10 p-5 ring-1 ring-white/10">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-blue-200">
        <Icon size={20} />
      </div>
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
