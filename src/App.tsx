import {
  useState,
  useSyncExternalStore,
  useEffect,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Heart,
  HelpCircle,
  History,
  Home,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  Usb,
  X,
} from "lucide-react";
import { statusText, stopStates } from "./analysis";
import {
  acknowledge,
  activeSession,
  beginCheck,
  confirmCheck,
  currentSample,
  currentScenario,
  demoDate,
  login,
  pump,
  recordFailedCheck,
  references,
  resetDemo,
  restart,
  scenarios,
  selectScenario,
  store,
  topics,
  update,
  uploadCsv,
  startFeed,
  type DemoState,
  type Plan,
} from "./store";
import { loadSharedDemo, synchronize, syncStore } from "./persistence";
import { connectSerial, disconnectSerial, serialSupported } from "./serial";
import type { Sample } from "./csv";
import CaregiverWorkflow from "./CaregiverWorkflow";
type Tab = "today" | "placement" | "feeding" | "resources" | "history";
const fmt = (v: unknown, decimals = 2) =>
  typeof v === "number" ? v.toFixed(decimals) : "Unavailable";
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const timeOf = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s/g, "");
const iconSize = 21;
function Graph({
  rows,
  fields,
  title,
}: {
  rows: Sample[];
  fields: { key: string; label: string; color: string }[];
  title: string;
}) {
  const data = rows.slice(-150);
  const values = data.flatMap((r) =>
    fields
      .map((f) => r[f.key])
      .filter((v): v is number => typeof v === "number"),
  );
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const span = max - min || 1;
  return (
    <figure className="graph">
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 600 140"
        role="img"
        aria-label={`${title}. Last ${data.length} samples. ${values.length ? "Range " + fmt(min) + " to " + fmt(max) : "No measured values"}`}
      >
        <line x1="40" y1="110" x2="590" y2="110" stroke="#dce5e0" />
        <text x="0" y="20">
          {fmt(max, 1)}
        </text>
        <text x="0" y="110">
          {fmt(min, 1)}
        </text>
        {fields.map((f) => {
          let path = "",
            pen = false;
          data.forEach((r, i) => {
            const v = r[f.key];
            if (typeof v !== "number") {
              pen = false;
              return;
            }
            path += `${pen ? "L" : "M"}${40 + (i / Math.max(1, data.length - 1)) * 540},${110 - ((v - min) / span) * 90} `;
            pen = true;
          });
          return (
            <path
              key={f.key}
              d={path}
              fill="none"
              stroke={f.color}
              strokeWidth="2.5"
            />
          );
        })}
        <text x="40" y="135">
          {fmt(data[0]?.elapsed_s, 1)} s
        </text>
        <text x="530" y="135">
          {fmt(data.at(-1)?.elapsed_s, 1)} s
        </text>
      </svg>
      <div className="legend">
        {fields.map((f) => (
          <span key={f.key}>
            <i style={{ background: f.color }} />
            {f.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
function Status({ s }: { s: DemoState }) {
  const a = s.analysis.state,
    good =
      a === "GASTRIC_COMPATIBLE" ||
      a === "FEEDING_NORMAL" ||
      a === "DEMO_FEED_COMPLETE",
    bad = stopStates.has(a) || a === "POSSIBLE_AIRWAY",
    pending = a === "COLLECTING";
  const Icon = good
    ? CheckCircle2
    : bad
      ? TriangleAlert
      : pending
        ? Activity
        : HelpCircle;
  return (
    <div
      className={`status ${good ? "good" : bad ? "bad" : "caution"}`}
      role="status"
    >
      <Icon size={36} />
      <div>
        <h2>{statusText[a][0]}</h2>
        <p>{statusText[a][1]}</p>
        <small>
          {s.analysis.window.length} valid samples in current window ·{" "}
          {s.index === 0
            ? "No readings collected"
            : `Source time ${currentSample()?.timestamp_utc ?? "unavailable"}`}
        </small>
      </div>
    </div>
  );
}
function PlanCard({ plan, s }: { plan: Plan; s: DemoState }) {
  const until = (Date.parse(plan.time) - demoDate(s).getTime()) / 60000;
  return (
    <article className="plan-card">
      <div className="spread">
        <span className="eyebrow">
          <Clock size={16} /> SCHEDULED FEEDING
        </span>
        <span className="pill">
          {until <= 0
            ? "Due in demo clock"
            : until <= plan.reminder
              ? "Reminder due"
              : `${Math.ceil(until)} min away`}
        </span>
      </div>
      <h2>
        {timeOf(plan.time)}{" "}
        <small>
          {new Date(plan.time).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </small>
      </h2>
      <div className="numbers">
        <div>
          <strong>
            {plan.volume}
            <small> mL</small>
          </strong>
          <span>Requested amount</span>
        </div>
        <div>
          <strong>
            {plan.rate}
            <small> mL/hr</small>
          </strong>
          <span>Requested rate</span>
        </div>
        <div>
          <strong>
            {Math.round((plan.volume / plan.rate) * 60)}
            <small> min</small>
          </strong>
          <span>Planned duration</span>
        </div>
      </div>
      <div className="instruction">
        <FileText size={18} />
        <p>{plan.instructions}</p>
      </div>
    </article>
  );
}
function DemoControls({ s }: { s: DemoState }) {
  const [baud, setBaud] = useState(115200),
    [reset, setReset] = useState(false);
  const c = currentScenario();
  return (
    <details className="demo-controls">
      <summary>
        <Settings2 size={18} />
        <strong>Demo controls</strong>
        <span>
          {c.label} · {s.speed}×
        </span>
      </summary>
      <div className="controls-content">
        <label>
          Data source
          <select
            value={s.sourceMode}
            onChange={(e) => {
              void disconnectSerial();
              update({
                sourceMode: e.target.value as "csv" | "serial",
                playing: false,
              });
              restart();
              if (e.target.value === "csv") selectScenario("P01");
            }}
          >
            <option value="csv">Bundled or uploaded CSV</option>
            <option value="serial">Arduino USB (read only)</option>
          </select>
        </label>
        <label>
          Scenario
          <select
            disabled={s.sourceMode === "serial"}
            value={s.scenarioId}
            onChange={(e) => selectScenario(e.target.value)}
          >
            {scenarios().map((v) => (
              <option key={v.id} value={v.id}>
                {v.phase} · {v.label}
              </option>
            ))}
          </select>
        </label>
        <p>{c.note}</p>
        <div className="spread">
          <span className="muted">
            {c.source}
            <br />
            Simulated elapsed:{" "}
            <strong>{time(currentSample()?.elapsed_s ?? 0)}</strong> · {s.index}
            /{c.samples.length} samples
          </span>
          <label>
            Playback speed
            <select
              value={s.speed}
              onChange={(e) => update({ speed: Number(e.target.value) })}
            >
              {[1, 5, 20].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button
            disabled={s.sourceMode !== "csv" || s.index >= c.samples.length}
            onClick={() => update({ playing: !s.playing })}
          >
            {s.playing ? <Pause size={18} /> : <Play size={18} />}{" "}
            {s.playing ? "Pause replay" : "Play replay"}
          </button>
          <button onClick={restart}>
            <RotateCcw size={18} /> Restart replay
          </button>
        </div>
        <small>
          Replay controls move prerecorded readings. Feed controls only change
          the simulated session. Starting a new scenario ends any active session
          and resets analysis.
        </small>
        <label className="upload">
          Upload replacement sensor CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                uploadCsv(await file.text(), file.name);
              } catch (err) {
                update({ error: (err as Error).message });
              }
              e.target.value = "";
            }}
          />
        </label>
        {s.sourceMode === "serial" && (
          <div className="usb">
            <p>
              <Usb size={18} />{" "}
              {serialSupported()
                ? s.serialStatus
                : "Unsupported browser · use CSV replay"}
            </p>
            <label>
              Baud rate
              <input
                type="number"
                min="1200"
                max="2000000"
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
              />
            </label>
            <div className="button-row">
              <button
                disabled={
                  !serialSupported() ||
                  !Number.isFinite(baud) ||
                  baud < 1200 ||
                  baud > 2000000
                }
                onClick={() => void connectSerial(baud)}
              >
                Connect USB
              </button>
              <button onClick={() => void disconnectSerial()}>
                Disconnect USB
              </button>
            </div>
            <small>
              Web Serial is browser-dependent. Android USB has not been tested.
              No hardware commands are sent.
            </small>
          </div>
        )}
        <button className="text-button danger" onClick={() => setReset(!reset)}>
          Reset demo…
        </button>
        {reset && (
          <div className="confirm-reset">
            <p>
              Clear this shared synthetic demo’s plans, checks, alerts, and
              history?
            </p>
            <button
              className="danger-button"
              onClick={() => {
                resetDemo();
                setReset(false);
              }}
            >
              Yes, reset demo
            </button>
            <button onClick={() => setReset(false)}>Cancel</button>
          </div>
        )}
      </div>
    </details>
  );
}
function PlanEditor({ s }: { s: DemoState }) {
  const [editing, setEditing] = useState<Plan | null>(null),
    [message, setMessage] = useState("");
  const edit = editing;
  function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (
      !(edit.volume > 0 && edit.rate > 0 && edit.reminder >= 0) ||
      !Number.isFinite(Date.parse(edit.time))
    ) {
      setMessage(
        "Enter a valid time, positive amount/rate, and nonnegative reminder.",
      );
      return;
    }
    update({
      plans: s.plans.some((v) => v.id === edit.id)
        ? s.plans.map((v) => (v.id === edit.id ? edit : v))
        : [...s.plans, edit],
    });
    setEditing(null);
    setMessage("Plan saved. The caregiver view now uses this plan.");
  }
  return (
    <section className="card">
      <div className="spread">
        <h2>Feeding plans</h2>
        <button
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              time: new Date(demoDate(s).getTime() + 3600000).toISOString(),
              volume: 30,
              rate: 60,
              reminder: 10,
              instructions: "Fictional demo order.",
            })
          }
        >
          Add plan
        </button>
      </div>
      {s.plans.map((p) => (
        <div className="list-row" key={p.id}>
          <div>
            <strong>
              {timeOf(p.time)} · {p.volume} mL at {p.rate} mL/hr
            </strong>
            <p>{p.instructions}</p>
            <small>Reminder {p.reminder} min before</small>
          </div>
          <button
            onClick={() => {
              setEditing(p);
              setMessage("");
            }}
          >
            Edit plan
          </button>
        </div>
      ))}
      {edit && (
        <form className="editor" onSubmit={save}>
          <h3>
            {s.plans.some((p) => p.id === edit.id)
              ? "Edit feeding plan"
              : "New feeding plan"}
          </h3>
          <label>
            Feeding time (UTC)
            <input
              type="datetime-local"
              required
              value={edit.time.slice(0, 16)}
              onChange={(e) =>
                setEditing({ ...edit, time: e.target.value + ":00Z" })
              }
            />
          </label>
          <div className="form-grid">
            <label>
              Amount (mL)
              <input
                type="number"
                required
                min="0.1"
                step="any"
                value={edit.volume}
                onChange={(e) =>
                  setEditing({ ...edit, volume: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Rate (mL/hr)
              <input
                type="number"
                required
                min="0.1"
                step="any"
                value={edit.rate}
                onChange={(e) =>
                  setEditing({ ...edit, rate: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Reminder (minutes)
              <input
                type="number"
                required
                min="0"
                value={edit.reminder}
                onChange={(e) =>
                  setEditing({ ...edit, reminder: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            Written instructions
            <textarea
              required
              value={edit.instructions}
              onChange={(e) =>
                setEditing({ ...edit, instructions: e.target.value })
              }
            />
          </label>
          <div className="button-row">
            <button className="primary" type="submit">
              Save plan
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function Resources({
  s,
  topic,
  setTopic,
}: {
  s: DemoState;
  topic: string;
  setTopic: (v: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [note, setNote] = useState("");
  return (
    <>
      <div className="section-heading">
        {s.role === "clinician" && (
          <span className="eyebrow">DEMONSTRATION LIBRARY</span>
        )}
        <h1>{s.role === "caregiver" ? "Videos" : "Videos and resources"}</h1>
        <p>
          {s.role === "caregiver"
            ? "Videos are optional."
            : "Demo videos. No video files are loaded."}
        </p>
      </div>
      <label>
        Search resources
        <input
          placeholder="Search by topic"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <section className="card">
        <h2>{s.role === "caregiver" ? "Your videos" : "Assigned resources"}</h2>
        {s.assignments.map((a) => (
          <div className="list-row" key={a.id}>
            <div>
              <strong>{a.topic}</strong>
              <p>{a.note}</p>
              <small>{a.viewed ? "✓ Marked viewed" : "Not yet viewed"}</small>
            </div>
            <div className="stack">
              <button onClick={() => setTopic(a.topic)}>Open resource</button>
              <button
                disabled={a.viewed}
                onClick={() =>
                  update({
                    assignments: s.assignments.map((v) =>
                      v.id === a.id ? { ...v, viewed: true } : v,
                    ),
                  })
                }
              >
                Mark viewed
              </button>
            </div>
          </div>
        ))}
      </section>
      <div className="resource-grid">
        {topics
          .filter((t) => t.toLowerCase().includes(query.toLowerCase()))
          .map((t) => (
            <button className="resource" key={t} onClick={() => setTopic(t)}>
              <span className="resource-icon">
                <Play size={24} />
              </span>
              <strong>{t}</strong>
              <small>Demo resource · placeholder video</small>
              <ChevronRight size={18} />
            </button>
          ))}
      </div>
      {s.role === "clinician" && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            update({
              assignments: [
                ...s.assignments,
                {
                  id: crypto.randomUUID(),
                  topic: topic || topics[0],
                  note,
                  viewed: false,
                },
              ],
            });
            setNote("");
          }}
        >
          <h2>Assign a tutorial</h2>
          <label>
            Topic
            <select
              value={topic || topics[0]}
              onChange={(e) => setTopic(e.target.value)}
            >
              {topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Short note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for caregiver"
            />
          </label>
          <button className="primary">Assign resource</button>
        </form>
      )}
      {topic && (
        <section className="card resource-panel">
          <div className="spread">
            <h2>{topic}</h2>
            <button aria-label="Close resource" onClick={() => setTopic("")}>
              <X size={18} />
            </button>
          </div>
          <div className="video-placeholder">
            <Play size={42} />
            <strong>Placeholder video</strong>
            <p>No actual video is playing.</p>
          </div>
          <p>
            This resource explains the demo app. It does not provide insertion
            instructions. Actual care requires approved training and placement
            confirmation.
          </p>
          <p>
            {topic.includes("placement")
              ? "Collect new readings. pH and CO₂ alone cannot confirm tube placement."
              : topic.includes("alert")
                ? "A warning stops the simulated feed. Acknowledging it does not fix the problem. Open sensor details or restart the scenario to review it."
                : "This app simulates feeding. No real pump is connected."}
          </p>
        </section>
      )}
    </>
  );
}
function HistoryView({ s }: { s: DemoState }) {
  return (
    <>
      <div className="section-heading">
        <span className="eyebrow">SHARED RECORDS</span>
        <h1>Checks & feeding history</h1>
        <p>Saved demo records.</p>
      </div>
      <section className="card">
        <h2>Placement checks</h2>
        {!s.checks.length && <p>No placement checks recorded yet.</p>}
        {s.checks
          .slice()
          .reverse()
          .map((c) => (
            <details className="history-item" key={c.id}>
              <summary>
                {c.kind} · {c.assessment.replaceAll("_", " ")}
                <small>
                  {c.confirmed
                    ? "Fictional confirmation recorded"
                    : "Not confirmed"}{" "}
                  · demo {time(c.at)}
                </small>
              </summary>
              <p>
                Scenario {c.scenario} · original source {c.sourceTimestamp}
              </p>
              <Graph
                rows={c.readings}
                title="CO₂ (mmHg) at check"
                fields={[{ key: "co2_mmhg", label: "CO₂", color: "#176c60" }]}
              />
              <Graph
                rows={c.readings}
                title="pH at check"
                fields={[{ key: "ph", label: "pH", color: "#8a66b2" }]}
              />
            </details>
          ))}
      </section>
      <section className="card">
        <h2>Feeding sessions</h2>
        {!s.sessions.length && (
          <p>
            No feeding sessions yet. Complete insertion assistance to begin.
          </p>
        )}
        {s.sessions
          .slice()
          .reverse()
          .map((v) => (
            <details className="history-item" key={v.id}>
              <summary>
                {v.status} · {fmt(v.volume)} / {v.target} mL
                <small>
                  {v.scenario} · {time(v.elapsed)} simulated · {v.missing}{" "}
                  missing intervals
                </small>
              </summary>
              <p>
                {v.reason || "Session in progress."} Check {v.checkId} ·{" "}
                {v.missing
                  ? "Known volume only; incomplete measured total."
                  : "All active delivery intervals measured."}
              </p>
              <Graph
                rows={v.records}
                title="Measured flow (mL/hr)"
                fields={[
                  {
                    key: "proximal_flow_ml_hr",
                    label: "Proximal",
                    color: "#176c60",
                  },
                  {
                    key: "distal_flow_ml_hr",
                    label: "Distal",
                    color: "#bb7928",
                  },
                ]}
              />
              <Graph
                rows={v.records}
                title="Pressure (kPa gauge)"
                fields={[
                  {
                    key: "proximal_pressure_kpa",
                    label: "Proximal",
                    color: "#176c60",
                  },
                  {
                    key: "distal_pressure_kpa",
                    label: "Distal",
                    color: "#bb7928",
                  },
                ]}
              />
              <button onClick={() => void synchronize()}>
                Share session with Clinician
              </button>
              <small>
                Shared in this app. Hospital-chart integration is simulated.
              </small>
            </details>
          ))}
      </section>
      <section className="card">
        <h2>Alert history</h2>
        {!s.alerts.length && <p>No alerts recorded.</p>}
        {s.alerts
          .slice()
          .reverse()
          .map((a) => (
            <div className="list-row" key={a.id}>
              <div>
                <strong>{a.state.replaceAll("_", " ")}</strong>
                <p>
                  {a.active ? "Active warning retained" : "Past alert"} ·{" "}
                  {a.acknowledgments.length} acknowledgment(s)
                </p>
                {a.acknowledgments.map((v, i) => (
                  <small className="block" key={i}>
                    {v.role} acknowledged at demo {time(v.at)}
                  </small>
                ))}
              </div>
              <button onClick={() => acknowledge(a.id)}>Acknowledge</button>
            </div>
          ))}
      </section>
    </>
  );
}
function Installation() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setReady(true));
  }, []);
  return (
    <details className="card install">
      <summary>Install on Android & connection notes</summary>
      <p>
        {ready
          ? "✓ Offline app shell is cached."
          : "Offline cache is available after loading the production preview."}
      </p>
      <ol>
        <li>Open the HTTPS deployment in Chrome on Android.</li>
        <li>Open the browser menu → Install app or Add to Home screen.</li>
        <li>
          Launch NG Tube Assistant from the home screen. After the first
          production load, bundled CSV data and the app work offline.
        </li>
      </ol>
      <p>
        The desktop localhost preview is installable locally. A phone needs an
        HTTPS host; a plain LAN IP is not sufficient. Cloud synchronization
        needs internet. There is no background monitoring.
      </p>
      <p>
        USB support depends on the browser and device. Use CSV on unsupported
        devices. All device control and hospital communication are simulated.
      </p>
    </details>
  );
}
export default function App() {
  const s = useSyncExternalStore(store.subscribe, store.get),
    sync = useSyncExternalStore(syncStore.subscribe, syncStore.get);
  const [tab, setTab] = useState<Tab>("today"),
    [topic, setTopic] = useState(""),
    [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const c = currentScenario(),
    row = currentSample(),
    active = activeSession(),
    lastSession = s.sessions.at(-1),
    plan = s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0];
  const help = (t: string) => {
    setTopic(t);
    setTab("resources");
  };
  const startCheck = (kind: "Insertion" | "Pre-feed") => {
    setConfirmed(false);
    beginCheck(kind);
    setTab("placement");
  };
  const nav =
    s.role === "caregiver"
      ? [
          { id: "today" as Tab, label: "Feeding", icon: Heart },
          { id: "resources" as Tab, label: "Videos", icon: Play },
        ]
      : [
          {
            id: "today" as Tab,
            label: s.role === "clinician" ? "Overview" : "Today",
            icon: Home,
          },
          { id: "placement" as Tab, label: "Placement", icon: ShieldCheck },
          { id: "feeding" as Tab, label: "Feeding", icon: Activity },
          { id: "resources" as Tab, label: "Help", icon: HelpCircle },
          { id: "history" as Tab, label: "History", icon: History },
        ];
  return (
    <>
      <div className="demo-banner">DEMO — simulated patient and device</div>
      {!s.role ? (
        <main className="login-layout">
          <div className="brand">
            <span className="brand-mark">
              <Activity size={28} />
            </span>
            <span>
              NG Tube <strong>Assistant</strong>
            </span>
          </div>
          <div className="login-card">
            <span className="eyebrow">OSU BioHack Fall 2026 Team 15</span>
            <h1>
              NG tube placement and feeding
              <br />
              Caregiver and Clinician sign-in
            </h1>
            <p>Demo only. No real patient or device is connected.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  (user === "caregiver" || user === "clinician") &&
                  password === "123"
                ) {
                  login(user);
                  setLoginError("");
                } else
                  setLoginError(
                    "Use caregiver or clinician with password 123.",
                  );
              }}
            >
              <label>
                Username
                <input
                  autoComplete="username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {loginError && (
                <p className="error" role="alert">
                  {loginError}
                </p>
              )}
              <button className="primary full">
                Enter demo <ArrowRight size={18} />
              </button>
            </form>
            <div className="login-divider">or choose a demo view</div>
            <div className="button-row">
              <button onClick={() => login("caregiver")}>
                <Heart size={18} /> Enter caregiver demo
              </button>
              <button onClick={() => login("clinician")}>
                <Stethoscope size={18} /> Enter Clinician demo
              </button>
            </div>
            <small>
              Demo login: caregiver / 123 or clinician / 123. No real
              authentication.
            </small>
          </div>
          <Installation />
        </main>
      ) : (
        <div
          className={`app-layout ${s.role === "caregiver" ? "caregiver-layout" : ""}`}
        >
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark">
                <Activity size={25} />
              </span>
              <span>
                NG Tube
                <br />
                <strong>Assistant</strong>
              </span>
            </div>
            <div className="view-label">{s.role} view</div>
            <nav>
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={
                    tab === n.id ||
                    (s.role === "caregiver" &&
                      n.id === "today" &&
                      tab !== "resources")
                      ? "selected"
                      : ""
                  }
                  onClick={() => setTab(n.id)}
                >
                  <n.icon size={iconSize} />
                  <span>{n.label}</span>
                  {n.id === "placement" && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            {s.role === "clinician" && (
              <div className="sidebar-footer">
                <ShieldCheck size={24} />
                <strong>Demo only</strong>
                <p>
                  Fictional patient.
                  <br />
                  Sensor readings alone do not confirm placement.
                </p>
              </div>
            )}
          </aside>
          <div className="workspace">
            <header className="topbar">
              <span className="patient">
                <span className="avatar">
                  {s.role === "caregiver" ? <Heart size={19} /> : "AD"}
                </span>
                <span>
                  <strong>
                    {s.role === "caregiver" ? "Caregiver" : "Demo Patient"}
                  </strong>
                  {s.role === "clinician" && <small>DEMO-PATIENT-01</small>}
                </span>
              </span>
              <div className="role-switch" aria-label="Switch demo view">
                {(["caregiver", "clinician"] as const).map((role) => (
                  <button
                    key={role}
                    className={s.role === role ? "active" : ""}
                    onClick={() => login(role)}
                  >
                    {role === "caregiver" ? "Caregiver" : "Clinician"}
                  </button>
                ))}
              </div>
              <button
                className="text-button signout"
                onClick={() => login(null)}
              >
                Sign out
              </button>
            </header>
            <main className="content">
              {s.role === "clinician" && (
                <div className="storage-strip">
                  <span>
                    <span
                      className={`sync-dot ${sync.startsWith("Synchronized") ? "connected" : ""}`}
                    />
                    {sync}
                  </span>
                  <span>
                    <Clock size={14} /> Demo clock{" "}
                    {demoDate(s).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {timeOf(demoDate(s).toISOString())}
                  </span>
                </div>
              )}
              {sync.includes("conflict") && (
                <div className="notice">
                  <p>
                    A shared update exists. Export this local copy before
                    loading it if needed.
                  </p>
                  <button onClick={() => void loadSharedDemo()}>
                    Load shared demo
                  </button>
                  <button
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = URL.createObjectURL(
                        new Blob([JSON.stringify(s)], {
                          type: "application/json",
                        }),
                      );
                      link.download = "ng-demo-local-copy.json";
                      link.click();
                      URL.revokeObjectURL(link.href);
                    }}
                  >
                    Export local copy
                  </button>
                </div>
              )}
              {s.error && (
                <div className="notice error" role="alert">
                  <TriangleAlert size={20} />
                  <p>{s.error}</p>
                  <button
                    aria-label="Dismiss error"
                    onClick={() => update({ error: "" })}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {s.alerts
                .filter((a) => a.active)
                .map((a) => (
                  <div className="active-alert" key={a.id} role="alert">
                    <TriangleAlert size={25} />
                    <div>
                      <strong>
                        {statusText[a.state as keyof typeof statusText]?.[0] ??
                          a.state}
                      </strong>
                      <p>
                        Simulation stopped. Warning retained ·{" "}
                        {a.acknowledgments.length
                          ? "Acknowledged; cause remains unresolved."
                          : "Not acknowledged."}
                      </p>
                      <div className="button-row">
                        <button onClick={() => acknowledge(a.id)}>
                          Acknowledge warning
                        </button>
                        {s.role === "clinician" && (
                          <button onClick={() => help(topics[3])}>
                            Alert help
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              {s.role === "caregiver" && tab !== "resources" && (
                <CaregiverWorkflow s={s} />
              )}
              {s.role === "clinician" && tab === "today" && (
                <>
                  <div className="section-heading">
                    <span className="eyebrow">CLINICIAN OVERVIEW</span>
                    <h1>Demo Patient overview</h1>
                    <p>
                      {s.tubeInserted
                        ? "Tube recorded as inserted. Collect a fresh check before each feed."
                        : "Initial insertion check needed."}
                    </p>
                  </div>

                  <>
                    <section className="card">
                      <span className="eyebrow">
                        SYNTHETIC PATIENT & DEVICE
                      </span>
                      <h2>
                        Demo Patient <span className="pill">Fictional</span>
                      </h2>
                      <div className="numbers">
                        <div>
                          <strong>{s.checks.length}</strong>
                          <span>Placement checks</span>
                        </div>
                        <div>
                          <strong>{s.sessions.length}</strong>
                          <span>Feed sessions</span>
                        </div>
                        <div>
                          <strong>
                            {s.alerts.filter((a) => a.active).length}
                          </strong>
                          <span>Active warnings</span>
                        </div>
                      </div>
                      <p>
                        DEMO-DEVICE-01 ·{" "}
                        {s.tubeInserted
                          ? "Tube recorded as inserted"
                          : "Initial insertion pending"}
                      </p>
                      <div className="button-row">
                        <button
                          className="primary"
                          onClick={() => startCheck("Insertion")}
                        >
                          Open insertion assistance
                        </button>
                        <button onClick={() => setTab("history")}>
                          Review history
                        </button>
                      </div>
                    </section>
                    <PlanEditor s={s} />
                    <button onClick={() => help(topics[1])}>
                      Assign or review tutorials <ArrowRight size={17} />
                    </button>
                  </>
                </>
              )}
              {s.role === "clinician" && tab === "placement" && (
                <>
                  <div className="section-heading">
                    <span className="eyebrow">
                      {s.checkKind === "Pre-feed"
                        ? "FRESH CHECK BEFORE FEEDING"
                        : "INSERTION ASSISTANCE"}
                    </span>
                    <h1>
                      {s.checkKind === "Pre-feed"
                        ? "Pre-feed placement check"
                        : "Insertion placement check"}
                    </h1>
                    <p>
                      Sensor readings alone cannot confirm placement or
                      authorize feeding.
                    </p>
                  </div>
                  <section className="card placement-card">
                    <div className="spread">
                      <span className="phase-tag">01 · PLACEMENT</span>
                      <button onClick={() => help(topics[1])}>
                        <HelpCircle size={20} /> Help & tutorial
                      </button>
                    </div>
                    <Status s={s} />
                    {!s.checkKind && (
                      <div className="button-row">
                        <button
                          className="primary"
                          onClick={() =>
                            startCheck(
                              s.tubeInserted ? "Pre-feed" : "Insertion",
                            )
                          }
                        >
                          Collect fresh readings
                        </button>
                      </div>
                    )}
                    {s.checkKind &&
                      s.analysis.state === "GASTRIC_COMPATIBLE" && (
                        <div className="fictional-confirm">
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={confirmed}
                              onChange={(e) => setConfirmed(e.target.checked)}
                            />
                            <span>
                              For this demo, the required placement confirmation
                              is complete.
                            </span>
                          </label>
                          <button
                            className="primary full"
                            disabled={!confirmed}
                            onClick={() => {
                              if (confirmCheck()) {
                                setTab("feeding");
                                setConfirmed(false);
                              }
                            }}
                          >
                            Continue demo <ArrowRight size={19} />
                          </button>
                        </div>
                      )}
                    {s.checkKind &&
                      s.analysis.state !== "GASTRIC_COMPATIBLE" && (
                        <div className="button-row">
                          <button
                            disabled={s.analysis.state === "COLLECTING"}
                            onClick={recordFailedCheck}
                          >
                            Record incomplete check
                          </button>
                          <button onClick={() => startCheck(s.checkKind!)}>
                            Collect again
                          </button>
                        </div>
                      )}
                    <details
                      className="sensor-details"
                      open={s.role === "clinician"}
                    >
                      <summary>Sensor details · pH & CO₂ waveform</summary>
                      <div className="numbers">
                        <div>
                          <strong>{fmt(row?.ph)}</strong>
                          <span>pH</span>
                        </div>
                        <div>
                          <strong>
                            {fmt(row?.co2_mmhg)}
                            <small> mmHg</small>
                          </strong>
                          <span>Gas CO₂</span>
                        </div>
                        <div>
                          <strong>{s.analysis.pulses}</strong>
                          <span>CO₂ upward crossings</span>
                        </div>
                      </div>
                      <Graph
                        rows={c.samples.slice(0, s.index)}
                        title="CO₂ waveform (mmHg)"
                        fields={[
                          { key: "co2_mmhg", label: "CO₂", color: "#176c60" },
                        ]}
                      />
                      <Graph
                        rows={c.samples.slice(0, s.index)}
                        title="pH readings"
                        fields={[{ key: "ph", label: "pH", color: "#8a66b2" }]}
                      />
                      <p>
                        Requires 50 consecutive valid samples at 5 Hz. Absent
                        CO₂ does not prove stomach placement. P01 and P05 are
                        intentionally indistinguishable.
                      </p>
                    </details>
                  </section>
                </>
              )}
              {s.role === "clinician" && tab === "feeding" && (
                <>
                  <div className="section-heading">
                    <span className="eyebrow">SIMULATED FEEDING</span>
                    <h1>{active ? "Feeding status" : "Feeding plan"}</h1>
                    <p>
                      All start, pause, and stop controls act only on this
                      simulation.
                    </p>
                  </div>
                  {!active && (
                    <>
                      <label>
                        Feeding plan
                        <select
                          value={s.selectedPlanId}
                          onChange={(e) =>
                            update({ selectedPlanId: e.target.value })
                          }
                        >
                          {s.plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {timeOf(p.time)} · {p.volume} mL / {p.rate} mL/hr
                            </option>
                          ))}
                        </select>
                      </label>
                      <PlanCard plan={plan} s={s} />
                      <section className="card">
                        <label>
                          Feeding scenario
                          <select
                            value={s.feedingScenarioId}
                            onChange={(e) =>
                              update({ feedingScenarioId: e.target.value })
                            }
                          >
                            {scenarios()
                              .filter(
                                (v) =>
                                  v.phase === "Feeding" &&
                                  !v.id.startsWith("USB"),
                              )
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <small>
                          Changing the plan does not change the recorded sensor
                          data.
                        </small>
                        {s.readyCheckId ? (
                          <p className="success-text">
                            <CheckCircle2 size={18} /> Placement check and demo
                            confirmation recorded.
                          </p>
                        ) : (
                          <p>
                            Complete a new placement check and demo confirmation
                            first.
                          </p>
                        )}
                        <div className="button-row">
                          <button
                            className="primary start-feeding"
                            disabled={!s.readyCheckId}
                            onClick={() => startFeed()}
                          >
                            Start simulated feed <Play size={18} />
                          </button>
                          <button
                            disabled={!s.tubeInserted}
                            onClick={() => startCheck("Pre-feed")}
                          >
                            Check tube before feeding
                          </button>
                        </div>
                      </section>
                    </>
                  )}
                  {c.phase === "Feeding" && (
                    <section className="card">
                      <span className="phase-tag">02 · FEEDING</span>
                      <Status s={s} />
                      <div className="spread">
                        <h2>
                          Session{" "}
                          {active?.status ??
                            lastSession?.status ??
                            "not started"}
                        </h2>
                        <span className="pill">
                          {s.playing ? "Replay running" : "Replay paused"}
                        </span>
                      </div>
                      <div className="volume">
                        <strong>
                          {fmt(active?.volume ?? lastSession?.volume ?? 0)}
                          <small>
                            {" "}
                            /{" "}
                            {active?.target ??
                              lastSession?.target ??
                              plan.volume}{" "}
                            mL
                          </small>
                        </strong>
                        <span>Known delivered during active simulation</span>
                      </div>
                      <progress
                        max={
                          active?.target ?? lastSession?.target ?? plan.volume
                        }
                        value={active?.volume ?? lastSession?.volume ?? 0}
                        aria-label="Known delivered volume"
                      />
                      <div className="numbers">
                        <div>
                          <strong>
                            {fmt(row?.distal_flow_ml_hr, 1)}
                            <small> mL/hr</small>
                          </strong>
                          <span>Measured distal flow</span>
                        </div>
                        <div>
                          <strong>
                            {time(active?.elapsed ?? lastSession?.elapsed ?? 0)}
                          </strong>
                          <span>Simulated session time</span>
                        </div>
                        <div>
                          <strong>
                            {active?.missing ?? lastSession?.missing ?? 0}
                          </strong>
                          <span>Missing active intervals</span>
                        </div>
                      </div>
                      <p>
                        {(active?.missing ?? lastSession?.missing ?? 0) > 0
                          ? "Measured total is incomplete. Missing intervals are not counted as zero delivery."
                          : "Only intervals while the simulated feed is running count toward its delivered volume."}
                      </p>
                      {active && (
                        <div className="button-row">
                          <button
                            onClick={() =>
                              pump(
                                active.status === "RUNNING"
                                  ? "pause"
                                  : "resume",
                              )
                            }
                          >
                            {active.status === "RUNNING" ? (
                              <Pause size={18} />
                            ) : (
                              <Play size={18} />
                            )}{" "}
                            {active.status === "RUNNING"
                              ? "Pause simulated feed"
                              : "Resume simulated feed"}
                          </button>
                          <button
                            className="danger-button"
                            onClick={() => pump("stop")}
                          >
                            Stop simulated feed
                          </button>
                        </div>
                      )}
                      {!active && lastSession && <p>{lastSession.reason}</p>}
                      <details
                        className="sensor-details"
                        open={s.role === "clinician"}
                      >
                        <summary>Flow, pressure & calculation details</summary>
                        <div className="metric-grid">
                          {[
                            [
                              "Commanded flow",
                              fmt(row?.commanded_flow_ml_hr) + " mL/hr",
                            ],
                            [
                              "Requested rate",
                              String(active?.rate ?? plan.rate) + " mL/hr",
                            ],
                            [
                              "Proximal pressure",
                              fmt(row?.proximal_pressure_kpa) + " kPa",
                            ],
                            [
                              "Distal pressure",
                              fmt(row?.distal_pressure_kpa) + " kPa",
                            ],
                            [
                              "Height proximal − distal",
                              fmt(row?.height_prox_minus_dist_m) + " m",
                            ],
                            [
                              "Gravity head",
                              fmt(s.analysis.metrics.gravity) + " kPa",
                            ],
                            [
                              "Corrected pressure drop",
                              fmt(s.analysis.metrics.corrected) + " kPa",
                            ],
                            [
                              "Extra pressure",
                              fmt(s.analysis.metrics.extra) + " kPa",
                            ],
                            [
                              "Replay known volume",
                              fmt(s.analysis.metrics.knownVolume) + " mL",
                            ],
                            [
                              "Replay missing intervals",
                              String(s.analysis.metrics.missingIntervals),
                            ],
                          ].map(([k, v]) => (
                            <div key={k}>
                              <span>{k}</span>
                              <strong>{v}</strong>
                            </div>
                          ))}
                        </div>
                        <Graph
                          rows={c.samples.slice(0, s.index)}
                          title="Measured flow (mL/hr)"
                          fields={[
                            {
                              key: "proximal_flow_ml_hr",
                              label: "Proximal",
                              color: "#176c60",
                            },
                            {
                              key: "distal_flow_ml_hr",
                              label: "Distal",
                              color: "#bb7928",
                            },
                          ]}
                        />
                        <Graph
                          rows={c.samples.slice(0, s.index)}
                          title="Gauge pressure (kPa)"
                          fields={[
                            {
                              key: "proximal_pressure_kpa",
                              label: "Proximal",
                              color: "#176c60",
                            },
                            {
                              key: "distal_pressure_kpa",
                              label: "Distal",
                              color: "#bb7928",
                            },
                          ]}
                        />
                        <p>
                          Pressure correction = proximal − distal + density ×
                          gravity × height / 1000. Extra pressure subtracts
                          baseline resistance × measured proximal flow.
                        </p>
                      </details>
                    </section>
                  )}
                </>
              )}
              {tab === "resources" && (
                <Resources s={s} topic={topic} setTopic={setTopic} />
              )}
              {s.role === "clinician" && tab === "history" && (
                <HistoryView s={s} />
              )}
              {s.role === "clinician" && tab !== "resources" && (
                <DemoControls s={s} />
              )}
              {s.role === "clinician" && <Installation />}
              {s.role === "clinician" && (
                <footer className="footer">
                  BioHack 2026 · Synthetic demonstration · No physical pump or
                  hospital chart connection
                  <details>
                    <summary>Dataset sources & limitations</summary>
                    {references.map((r) => (
                      <p key={r.source_id}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.publisher}: {r.reference}
                        </a>
                        <br />
                        {r.use_and_limit}
                      </p>
                    ))}
                  </details>
                </footer>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  );
}
