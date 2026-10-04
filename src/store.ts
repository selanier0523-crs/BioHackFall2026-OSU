import {
  parseCsv,
  parseSensors,
  type Phase,
  type Row,
  type Sample,
} from "./csv";
import {
  initialAnalysis,
  stepFeeding,
  stepPlacement,
  stopStates,
  type Analysis,
  type Settings,
} from "./analysis";
export type Scenario = {
  id: string;
  phase: Phase;
  label: string;
  note: string;
  samples: Sample[];
  source: string;
};
export type Plan = {
  id: string;
  time: string;
  volume: number;
  rate: number;
  reminder: number;
  instructions: string;
};
export type Assignment = {
  id: string;
  topic: string;
  note: string;
  viewed: boolean;
};
export type Check = {
  id: string;
  kind: "Insertion" | "Pre-feed";
  scenario: string;
  assessment: string;
  sourceTimestamp: string;
  confirmed: boolean;
  at: number;
  readings: Sample[];
};
export type Alert = {
  id: string;
  sessionId: string;
  state: string;
  at: number;
  active: boolean;
  acknowledgments: { role: string; at: number }[];
};
export type Session = {
  id: string;
  checkId: string;
  scenario: string;
  planId: string;
  target: number;
  rate: number;
  status: "RUNNING" | "PAUSED" | "STOPPED" | "COMPLETED";
  reason: string;
  volume: number;
  missing: number;
  elapsed: number;
  started: number;
  ended?: number;
  records: Sample[];
};
export type DemoState = {
  version: 1;
  role: "caregiver" | "clinician" | null;
  tubeInserted: boolean;
  plans: Plan[];
  assignments: Assignment[];
  checks: Check[];
  alerts: Alert[];
  sessions: Session[];
  scenarioId: string;
  index: number;
  playing: boolean;
  speed: number;
  analysis: Analysis;
  checkKind: "Insertion" | "Pre-feed" | null;
  readyCheckId: string | null;
  selectedPlanId: string;
  feedingScenarioId: string;
  demoSeconds: number;
  uploads: Scenario[];
  sourceMode: "csv" | "serial";
  serialStatus: string;
  error: string;
  revision: number;
};
const LOCAL_KEY = "ng-tube-assistant-v1";
const normalizePlans = (plans: Plan[]) =>
  plans.map((plan) =>
    plan.time === "2026-10-03T19:59:59.999Z"
      ? { ...plan, time: "2026-10-03T20:00:00.000Z" }
      : plan,
  );
export const topics = [
  "NG-tube insertion",
  "Understanding a placement check",
  "Preparing for feeding",
  "Responding to an alert",
  "Understanding feeding equipment",
];
let catalog: Scenario[] = [];
export let settings: Settings = {};
export let references: Row[] = [];
const baseTime = Date.parse("2026-10-03T19:55:00Z");
export const demoDate = (s: DemoState) =>
  new Date(baseTime + s.demoSeconds * 1000);
const uid = () => crypto.randomUUID();
function fresh(plans: Plan[], assignments: Assignment[]): DemoState {
  return {
    version: 1,
    role: null,
    tubeInserted: false,
    plans,
    assignments,
    checks: [],
    alerts: [],
    sessions: [],
    scenarioId: "P01",
    index: 0,
    playing: false,
    speed: 5,
    analysis: initialAnalysis(),
    checkKind: null,
    readyCheckId: null,
    selectedPlanId: plans[0].id,
    feedingScenarioId: "F01",
    demoSeconds: 0,
    uploads: [],
    sourceMode: "csv",
    serialStatus: "Disconnected",
    error: "",
    revision: 0,
  };
}
let state: DemoState;
let seed: DemoState;
const listeners = new Set<() => void>();
let durableListener: (() => void) | undefined;
export const store = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => state,
};
export const onDurableChange = (fn: () => void) => {
  durableListener = fn;
};
function emit(durable = true) {
  try {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ ...state, playing: false }),
    );
  } catch {
    state = {
      ...state,
      error:
        "Local storage is full or unavailable. Export or reset this demo before adding more data.",
    };
  }
  listeners.forEach((fn) => fn());
  if (durable) durableListener?.();
}
export function update(patch: Partial<DemoState>, durable = true) {
  state = { ...state, ...patch };
  emit(durable);
}
export function acceptRemote(remote: DemoState, revision: number) {
  const role = state.role;
  state = {
    ...remote,
    plans: normalizePlans(remote.plans),
    role,
    revision,
    playing: false,
    sourceMode: "csv",
    serialStatus: "Disconnected",
  };
  emit(false);
}
export function setRevision(revision: number) {
  state = { ...state, revision };
  emit(false);
}
export async function initialize() {
  const names = [
    "placement_inputs",
    "feeding_inputs",
    "settings",
    "scenarios",
    "care_plan",
    "sources",
  ];
  const text = await Promise.all(
    names.map(async (name) => {
      const r = await fetch(`/data/${name}.csv`);
      if (!r.ok) throw new Error(`Could not load ${name}.csv`);
      return r.text();
    }),
  );
  const placement = parseSensors(text[0]).samples,
    feeding = parseSensors(text[1]).samples;
  settings = Object.fromEntries(
    parseCsv(text[2]).map((r) => [r.parameter, Number(r.value)]),
  );
  catalog = parseCsv(text[3]).map((r) => ({
    id: r.scenario_id,
    phase: r.phase as Phase,
    label: r.label,
    note: r.note,
    source: "Bundled CSV",
    samples: (r.phase === "Placement" ? placement : feeding).filter(
      (v) => v.scenario_id === r.scenario_id,
    ),
  }));
  const plans = parseCsv(text[4]).map((r) => ({
    id: r.plan_id,
    time: r.start_time_utc,
    volume: Number(r.target_volume_ml),
    rate: Number(r.prescribed_flow_ml_hr),
    reminder: Number(r.reminder_lead_min),
    instructions: r.instructions,
  }));
  const assignments = parseCsv(text[4]).map((r, i) => ({
    id: `DEMO-TUTORIAL-${i + 1}`,
    topic: i === 0 ? topics[1] : i === 1 ? topics[3] : topics[2],
    note: r.education_title,
    viewed: false,
  }));
  references = parseCsv(text[5]);
  seed = fresh(plans, assignments);
  state = seed;
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (local?.version === 1)
      state = {
        ...local,
        plans: normalizePlans(local.plans),
        playing: false,
        sourceMode: "csv",
        serialStatus: "Disconnected",
      };
  } catch {
    state = {
      ...seed,
      error:
        "Saved demo could not be read. A fresh local demonstration is ready.",
    };
  }
  emit(false);
  window.addEventListener("storage", (e) => {
    if (e.key === LOCAL_KEY && e.newValue) {
      try {
        const remote = JSON.parse(e.newValue);
        state = {
          ...remote,
          plans: normalizePlans(remote.plans),
          role: state.role,
          playing: false,
        };
        listeners.forEach((fn) => fn());
      } catch {
        /* preserve current state */
      }
    }
  });
}
export const scenarios = () => [...catalog, ...(state?.uploads ?? [])];
export const currentScenario = () =>
  scenarios().find((v) => v.id === state.scenarioId)!;
export const currentSample = () =>
  state.index > 0 ? currentScenario()?.samples[state.index - 1] : undefined;
export const activeSession = () =>
  state.sessions.find((v) => v.status === "RUNNING" || v.status === "PAUSED");
export function login(role: "caregiver" | "clinician" | null) {
  update({ role }, false);
}
export function resetDemo() {
  state = {
    ...fresh(structuredClone(seed.plans), structuredClone(seed.assignments)),
    role: state.role,
    revision: state.revision,
  };
  emit();
}
export function endSession(reason: string) {
  const active = activeSession();
  if (active) {
    state = {
      ...state,
      sessions: state.sessions.map((v) =>
        v.id === active.id
          ? { ...v, status: "STOPPED", reason, ended: state.demoSeconds }
          : v,
      ),
      readyCheckId: null,
    };
  }
}
export function selectScenario(id: string) {
  if (id === state.scenarioId) return;
  endSession("Ended when the demonstration scenario changed.");
  const scenario = scenarios().find((v) => v.id === id)!;
  update({
    scenarioId: id,
    index: 0,
    playing: false,
    analysis: initialAnalysis(),
    checkKind: null,
    readyCheckId: scenario.phase === "Placement" ? null : state.readyCheckId,
    error: "",
  });
}
export function restart() {
  endSession("Ended by replay restart. A new placement check is required.");
  update({
    index: 0,
    playing: false,
    analysis: initialAnalysis(),
    readyCheckId: null,
    checkKind: null,
  });
}
export function beginCheck(kind: "Insertion" | "Pre-feed") {
  endSession("Ended to start a fresh placement check.");
  const scenario =
    currentScenario().phase === "Placement" ? state.scenarioId : "P01";
  update({
    tubeInserted: kind === "Insertion" ? false : state.tubeInserted,
    scenarioId: scenario,
    index: 0,
    playing: state.sourceMode === "csv",
    analysis: initialAnalysis(),
    readyCheckId: null,
    checkKind: kind,
    uploads:
      state.sourceMode === "serial"
        ? state.uploads.map((v) =>
            v.id === scenario ? { ...v, samples: [] } : v,
          )
        : state.uploads,
  });
}
export function confirmCheck(): boolean {
  if (state.analysis.state !== "GASTRIC_COMPATIBLE" || !state.checkKind)
    return false;
  const check: Check = {
    id: uid(),
    kind: state.checkKind,
    scenario: state.scenarioId,
    assessment: state.analysis.state,
    sourceTimestamp: currentSample()?.timestamp_utc ?? "",
    confirmed: true,
    at: state.demoSeconds,
    readings: state.analysis.window,
  };
  update({
    checks: [...state.checks, check],
    tubeInserted: true,
    readyCheckId: check.id,
    checkKind: null,
    playing: false,
  });
  return true;
}
export function recordFailedCheck() {
  if (!state.checkKind) return;
  const check: Check = {
    id: uid(),
    kind: state.checkKind,
    scenario: state.scenarioId,
    assessment: state.analysis.state,
    sourceTimestamp: currentSample()?.timestamp_utc ?? "",
    confirmed: false,
    at: state.demoSeconds,
    readings: state.analysis.window,
  };
  update({
    checks: [...state.checks, check],
    checkKind: null,
    playing: false,
    readyCheckId: null,
  });
}
export function startFeed() {
  if (state.sourceMode === "serial") {
    update({
      error:
        "Use CSV replay for simulated feeding. USB currently supports read-only placement assistance; live feeding has not been verified.",
    });
    return false;
  }
  if (!state.readyCheckId || activeSession()) return false;
  const plan = state.plans.find((v) => v.id === state.selectedPlanId)!;
  const check = state.checks.find((v) => v.id === state.readyCheckId);
  if (!check?.confirmed || state.sessions.some((v) => v.checkId === check.id))
    return false;
  const session: Session = {
    id: uid(),
    checkId: check.id,
    scenario: state.feedingScenarioId,
    planId: plan.id,
    target: plan.volume,
    rate: plan.rate,
    status: "RUNNING",
    reason: "",
    volume: 0,
    missing: 0,
    elapsed: 0,
    started: state.demoSeconds,
    records: [],
  };
  update({
    sessions: [...state.sessions, session],
    scenarioId: state.feedingScenarioId,
    index: 0,
    analysis: initialAnalysis(),
    playing: true,
    readyCheckId: null,
    checkKind: null,
  });
  return true;
}
export function pump(action: "pause" | "resume" | "stop") {
  const active = activeSession();
  if (!active) return;
  if (action === "resume" && stopStates.has(state.analysis.state)) return;
  if (action === "stop") endSession("Stopped by the demo user.");
  else
    state = {
      ...state,
      sessions: state.sessions.map((v) =>
        v.id === active.id
          ? { ...v, status: action === "pause" ? "PAUSED" : "RUNNING" }
          : v,
      ),
    };
  emit();
}
export function acknowledge(id: string) {
  update({
    alerts: state.alerts.map((v) =>
      v.id === id
        ? {
            ...v,
            acknowledgments: [
              ...v.acknowledgments,
              { role: state.role ?? "caregiver", at: state.demoSeconds },
            ],
          }
        : v,
    ),
  });
}
export function processSample(row: Sample, phase: Phase) {
  const active = activeSession();
  const analysis =
    phase === "Placement"
      ? stepPlacement(state.analysis, row, settings)
      : stepFeeding(state.analysis, row, settings);
  let sessions = state.sessions,
    alerts = state.alerts;
  if (phase === "Feeding" && active) {
    const running = active.status === "RUNNING";
    let updated: Session = {
      ...active,
      elapsed: active.elapsed + Number(row.interval_s),
      records: [...active.records, row],
      volume:
        active.volume + (running ? (analysis.metrics.intervalVolume ?? 0) : 0),
      missing:
        active.missing +
        (running && analysis.metrics.intervalVolume === null ? 1 : 0),
    };
    if (running && stopStates.has(analysis.state)) {
      updated = {
        ...updated,
        status: "STOPPED",
        reason: analysis.state,
        ended: state.demoSeconds,
      };
      alerts = [
        ...alerts,
        {
          id: `${active.id}:${analysis.state}`,
          sessionId: active.id,
          state: analysis.state,
          at: state.demoSeconds,
          active: true,
          acknowledgments: [],
        },
      ];
    } else if (
      running &&
      updated.missing === 0 &&
      updated.volume >= active.target - 1e-6
    ) {
      updated = {
        ...updated,
        status: "COMPLETED",
        reason: "Requested volume measured.",
        ended: state.demoSeconds,
      };
    }
    sessions = sessions.map((v) => (v.id === active.id ? updated : v));
  }
  state = {
    ...state,
    analysis,
    sessions,
    alerts,
    index: state.index + 1,
    demoSeconds:
      state.demoSeconds +
      Number(phase === "Placement" ? row.sample_interval_s : row.interval_s),
  };
}
// Process EVERY sensor interval even when a render tick advances several samples.
export function advance(count: number) {
  const scenario = currentScenario();
  for (let i = 0; i < count && state.index < scenario.samples.length; i++)
    processSample(scenario.samples[state.index], scenario.phase);
  if (state.index === scenario.samples.length) {
    state = { ...state, playing: false };
    endSession("Fixture ended before the requested amount was measured.");
  }
  emit();
}
export function uploadCsv(text: string, filename: string) {
  const { phase, samples } = parseSensors(text);
  const ids = [...new Set(samples.map((r) => r.scenario_id))];
  const stamp = uid().slice(0, 8);
  const uploads = ids.map((id) => ({
    id: `UPLOAD-${stamp}-${id}`,
    phase,
    label: `${filename} · ${id}`,
    note: "Uploaded sensor measurements. Assessment uses measured fields only.",
    source: `Uploaded CSV: ${filename}`,
    samples: samples.filter((r) => r.scenario_id === id),
  }));
  endSession("Ended for uploaded input.");
  update({
    uploads: [...state.uploads, ...uploads],
    scenarioId: uploads[0].id,
    index: 0,
    playing: false,
    analysis: initialAnalysis(),
    checkKind: null,
    readyCheckId: null,
  });
}
let carry = 0;
let last = performance.now();
setInterval(() => {
  if (!state) return;
  const now = performance.now(),
    delta = Math.min(now - last, 500);
  last = now;
  if (!state.playing || state.sourceMode !== "csv") {
    carry = 0;
    return;
  }
  const step = currentScenario().phase === "Placement" ? 0.2 : 1;
  carry += (delta / 1000) * state.speed;
  const count = Math.floor(carry / step);
  if (count) {
    carry -= count * step;
    advance(count);
  }
}, 100);
