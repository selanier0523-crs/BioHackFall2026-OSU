import { number, type Sample } from "./csv";
export type Settings = Record<string, number>;
export type Assessment =
  | "COLLECTING"
  | "SENSOR_UNAVAILABLE"
  | "GASTRIC_COMPATIBLE"
  | "POSSIBLE_AIRWAY"
  | "INCONCLUSIVE_CO2"
  | "PLACEMENT_UNCERTAIN"
  | "FEEDING_NORMAL"
  | "MONITOR"
  | "PAUSED"
  | "HIGH_RESISTANCE"
  | "POSSIBLE_OBSTRUCTION"
  | "OBSTRUCTION_ALERT"
  | "DELIVERY_MISMATCH"
  | "DEMO_FEED_COMPLETE";
export type Metrics = {
  gravity: number | null;
  corrected: number | null;
  extra: number | null;
  difference: number | null;
  fraction: number | null;
  intervalVolume: number | null;
  knownVolume: number;
  missingIntervals: number;
};
export type Analysis = {
  state: Assessment;
  window: Sample[];
  high: number;
  severe: number;
  mismatch: number;
  latched: boolean;
  metrics: Metrics;
  pulses: number;
};
export const initialAnalysis = (): Analysis => ({
  state: "COLLECTING",
  window: [],
  high: 0,
  severe: 0,
  mismatch: 0,
  latched: false,
  pulses: 0,
  metrics: {
    gravity: null,
    corrected: null,
    extra: null,
    difference: null,
    fraction: null,
    intervalVolume: null,
    knownVolume: 0,
    missingIntervals: 0,
  },
});
export function placementValid(r: Sample) {
  return (
    r.connected === 1 &&
    r.ph_valid === 1 &&
    r.co2_valid === 1 &&
    number(r, "ph") !== null &&
    number(r, "co2_mmhg") !== null
  );
}
export function feedingValid(r: Sample) {
  return (
    r.connected === 1 &&
    r.sensors_valid === 1 &&
    [
      "commanded_flow_ml_hr",
      "proximal_flow_ml_hr",
      "distal_flow_ml_hr",
      "proximal_pressure_kpa",
      "distal_pressure_kpa",
      "height_prox_minus_dist_m",
    ].every((k) => number(r, k) !== null)
  );
}
export function stepPlacement(
  prev: Analysis,
  r: Sample,
  s: Settings,
): Analysis {
  if (!placementValid(r))
    return { ...prev, state: "SENSOR_UNAVAILABLE", window: [], pulses: 0 };
  const size = s.placement_window_s * s.placement_sample_hz;
  const window = [...prev.window, r].slice(-size);
  if (window.length < size)
    return { ...prev, window, state: "COLLECTING", pulses: 0 };
  let pulses = 0;
  for (let i = 1; i < window.length; i++)
    if (
      Number(window[i - 1].co2_mmhg) <= s.co2_pulse_threshold &&
      Number(window[i].co2_mmhg) > s.co2_pulse_threshold
    )
      pulses++;
  const high = window.some((v) => Number(v.co2_mmhg) > s.co2_pulse_threshold);
  const acidic = window.every(
    (v) =>
      Number(v.ph) >= s.ph_gastric_lower && Number(v.ph) <= s.ph_gastric_upper,
  );
  return {
    ...prev,
    window,
    pulses,
    state:
      pulses >= 2
        ? "POSSIBLE_AIRWAY"
        : high
          ? "INCONCLUSIVE_CO2"
          : acidic
            ? "GASTRIC_COMPATIBLE"
            : "PLACEMENT_UNCERTAIN",
  };
}
export function calculate(
  r: Sample,
  s: Settings,
): Omit<Metrics, "knownVolume" | "missingIntervals"> {
  if (!feedingValid(r))
    return {
      gravity: null,
      corrected: null,
      extra: null,
      difference: null,
      fraction: null,
      intervalVolume: null,
    };
  const prox = Number(r.proximal_flow_ml_hr),
    dist = Number(r.distal_flow_ml_hr);
  const gravity =
    (s.density_kg_m3 * s.g_m_s2 * Number(r.height_prox_minus_dist_m)) /
    s.pa_per_kpa;
  const corrected =
    Number(r.proximal_pressure_kpa) - Number(r.distal_pressure_kpa) + gravity;
  return {
    gravity,
    corrected,
    extra: corrected - s.baseline_resistance * prox,
    difference: prox - dist,
    fraction: prox > 0 ? Math.abs(prox - dist) / prox : null,
    intervalVolume: (dist * Number(r.interval_s)) / s.seconds_per_hour,
  };
}
export function stepFeeding(
  prev: Analysis,
  r: Sample,
  s: Settings,
  target?: number,
): Analysis {
  const calc = calculate(r, s);
  const metrics = {
    ...calc,
    knownVolume: prev.metrics.knownVolume + (calc.intervalVolume ?? 0),
    missingIntervals:
      prev.metrics.missingIntervals + (calc.intervalVolume === null ? 1 : 0),
  };
  if (!feedingValid(r))
    return {
      ...prev,
      metrics,
      state: "SENSOR_UNAVAILABLE",
      window: [],
      high: 0,
      severe: 0,
      mismatch: 0,
    };
  const window = [...prev.window, r].slice(
    -s.flow_window_s * s.feeding_sample_hz,
  );
  let state: Assessment = "COLLECTING",
    high = prev.high,
    severe = prev.severe,
    mismatch = prev.mismatch,
    latched = prev.latched;
  if (r.pump_state === "PAUSED") {
    high = 0;
    severe = 0;
    mismatch = 0;
    state = "PAUSED";
  } else if (window.length === s.flow_window_s * s.feeding_sample_hz) {
    const mean = (key: string) =>
      window.reduce((a, v) => a + Number(v[key]), 0) / window.length;
    const excess =
      window.reduce((a, v) => a + calculate(v, s).extra!, 0) / window.length;
    const prox = mean("proximal_flow_ml_hr"),
      dist = mean("distal_flow_ml_hr"),
      command = mean("commanded_flow_ml_hr");
    high = excess > s.extra_pressure_kpa ? high + Number(r.interval_s) : 0;
    severe =
      dist < s.near_zero_flow_ml_hr && excess > s.severe_extra_kpa
        ? severe + Number(r.interval_s)
        : 0;
    mismatch =
      prox > 0 && Math.abs(prox - dist) / prox > s.flow_mismatch_fraction
        ? mismatch + Number(r.interval_s)
        : 0;
    if (severe >= s.severe_persistence_s) latched = true;
    state = latched
      ? "OBSTRUCTION_ALERT"
      : high >= s.alert_persistence_s
        ? dist < command * s.flow_low_fraction
          ? "POSSIBLE_OBSTRUCTION"
          : "HIGH_RESISTANCE"
        : mismatch >= s.alert_persistence_s
          ? "DELIVERY_MISMATCH"
          : high || severe || mismatch
            ? "MONITOR"
            : "FEEDING_NORMAL";
  }
  if (latched) state = "OBSTRUCTION_ALERT";
  if (
    target !== undefined &&
    metrics.missingIntervals === 0 &&
    metrics.knownVolume >= target - 1e-6 &&
    state === "FEEDING_NORMAL"
  )
    state = "DEMO_FEED_COMPLETE";
  return { ...prev, window, metrics, state, high, severe, mismatch, latched };
}
export const stopStates = new Set<Assessment>([
  "SENSOR_UNAVAILABLE",
  "HIGH_RESISTANCE",
  "POSSIBLE_OBSTRUCTION",
  "OBSTRUCTION_ALERT",
  "DELIVERY_MISMATCH",
]);
export const statusText: Record<Assessment, [string, string]> = {
  COLLECTING: [
    "Collecting readings",
    "Collecting enough valid readings to assess the result.",
  ],
  SENSOR_UNAVAILABLE: [
    "Do not proceed — sensor data unavailable",
    "Check the data connection and collect new readings.",
  ],
  GASTRIC_COMPATIBLE: [
    "Indicators compatible with stomach placement",
    "These readings cannot distinguish stomach placement from acid reflux. Clinical confirmation remains required.",
  ],
  POSSIBLE_AIRWAY: [
    "Do not proceed — possible airway placement",
    "Repeated CO₂ patterns were detected. Do not continue insertion.",
  ],
  INCONCLUSIVE_CO2: [
    "Do not proceed — placement check incomplete",
    "CO₂ is elevated without a repeated pattern. Readings are uncertain.",
  ],
  PLACEMENT_UNCERTAIN: [
    "Do not proceed — placement check incomplete",
    "The readings do not support stomach placement.",
  ],
  FEEDING_NORMAL: [
    "Feeding indicators normal",
    "Flow and pressure are within the demo limits after accounting for height.",
  ],
  MONITOR: [
    "Checking an unusual reading",
    "A reading is outside the demo limits. Checking whether it continues.",
  ],
  PAUSED: [
    "Prerecorded pump paused",
    "The recorded data includes an intentional pump pause.",
  ],
  HIGH_RESISTANCE: [
    "Stop feeding — increased resistance",
    "Pressure loss is elevated, even if both measured flows agree.",
  ],
  POSSIBLE_OBSTRUCTION: [
    "Stop feeding — possible obstruction",
    "Elevated pressure loss and reduced distal flow persist.",
  ],
  OBSTRUCTION_ALERT: [
    "Stop feeding — obstruction alert",
    "Flow at the tube end is near zero and pressure remains high. Clearing the warning does not restart feeding.",
  ],
  DELIVERY_MISMATCH: [
    "Stop feeding — flow readings differ",
    "The flow sensors disagree. This does not prove a blockage.",
  ],
  DEMO_FEED_COMPLETE: [
    "Demo feeding complete",
    "The requested volume has been measured with no missing intervals.",
  ],
};
