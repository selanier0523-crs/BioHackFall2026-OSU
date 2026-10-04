export type Row = Record<string, string>;
export type Sample = Record<string, string | number | null> & {
  scenario_id: string;
  elapsed_s: number;
  timestamp_utc: string;
};
export type Phase = "Placement" | "Feeding";
export const placementColumns = [
  "scenario_id",
  "device_id",
  "timestamp_utc",
  "elapsed_s",
  "sample_interval_s",
  "ph",
  "co2_mmhg",
  "connected",
  "ph_valid",
  "co2_valid",
];
export const feedingColumns = [
  "scenario_id",
  "device_id",
  "timestamp_utc",
  "elapsed_s",
  "interval_s",
  "commanded_flow_ml_hr",
  "proximal_flow_ml_hr",
  "distal_flow_ml_hr",
  "proximal_pressure_kpa",
  "distal_pressure_kpa",
  "height_prox_minus_dist_m",
  "connected",
  "sensors_valid",
  "pump_state",
];
// RFC 4180 quoting, including commas and newlines inside quoted fields.
export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let record: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      record.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      if (record.some((v) => v.trim())) records.push(record);
      record = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || record.length) {
    record.push(cell);
    records.push(record);
  }
  const headers = records.shift()?.map((v) => v.trim());
  if (!headers?.length || new Set(headers).size !== headers.length)
    throw new Error("CSV needs a header with unique column names.");
  return records.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2} has ${values.length} fields; expected ${headers.length}.`,
      );
    return Object.fromEntries(headers.map((key, j) => [key, values[j].trim()]));
  });
}
export function parseSensors(text: string): {
  phase: Phase;
  samples: Sample[];
} {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The CSV contains no measurements.");
  const phase: Phase = "ph" in rows[0] ? "Placement" : "Feeding";
  const columns = phase === "Placement" ? placementColumns : feedingColumns;
  const missing = columns.filter((key) => !(key in rows[0]));
  if (missing.length)
    throw new Error(`Missing columns: ${missing.join(", ")}.`);
  const strings = new Set([
    "scenario_id",
    "device_id",
    "timestamp_utc",
    "pump_state",
  ]);
  const flags = new Set([
    "connected",
    "ph_valid",
    "co2_valid",
    "sensors_valid",
  ]);
  const samples = rows
    .map((row, i) => {
      const out: Record<string, string | number | null> = {};
      for (const key of columns) {
        const raw = row[key];
        if (strings.has(key)) out[key] = raw;
        else {
          const n = raw === "" ? null : Number(raw);
          if (n !== null && !Number.isFinite(n))
            throw new Error(`Row ${i + 2}: ${key} must be a number or blank.`);
          out[key] = n;
          if (flags.has(key) && n !== 0 && n !== 1)
            throw new Error(`Row ${i + 2}: ${key} must be 0 or 1.`);
        }
      }
      if (
        !row.scenario_id ||
        !row.device_id ||
        !/Z$/.test(row.timestamp_utc) ||
        !Number.isFinite(Date.parse(row.timestamp_utc))
      )
        throw new Error(
          `Row ${i + 2}: scenario, device and ISO UTC timestamp are required.`,
        );
      if (typeof out.elapsed_s !== "number" || out.elapsed_s < 0)
        throw new Error(`Row ${i + 2}: elapsed_s must be nonnegative.`);
      const timing =
        phase === "Placement" ? out.sample_interval_s : out.interval_s;
      if (timing !== (phase === "Placement" ? 0.2 : 1))
        throw new Error(
          `Row ${i + 2}: use 0.2 s placement samples or 1 s feeding intervals.`,
        );
      for (const key of [
        "ph",
        "co2_mmhg",
        "commanded_flow_ml_hr",
        "proximal_flow_ml_hr",
        "distal_flow_ml_hr",
      ]) {
        const n = out[key];
        if (typeof n === "number" && (n < 0 || (key === "ph" && n > 14)))
          throw new Error(
            `Row ${i + 2}: ${key} is outside its supported range.`,
          );
      }
      if (
        phase === "Feeding" &&
        !["RUNNING", "PAUSED", "STOPPED", "STOPPED_FAULT"].includes(
          row.pump_state,
        )
      )
        throw new Error(
          `Row ${i + 2}: pump_state must be RUNNING, PAUSED, STOPPED or STOPPED_FAULT.`,
        );
      return out as Sample;
    })
    .sort(
      (a, b) =>
        a.scenario_id.localeCompare(b.scenario_id) || a.elapsed_s - b.elapsed_s,
    );
  for (let i = 1; i < samples.length; i++)
    if (samples[i].scenario_id === samples[i - 1].scenario_id) {
      const a = samples[i - 1],
        b = samples[i];
      const step = phase === "Placement" ? 0.2 : 1;
      if (
        Math.abs(b.elapsed_s - a.elapsed_s - step) > 1e-5 ||
        Math.abs(
          (Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc)) / 1000 -
            step,
        ) > 1e-5
      )
        throw new Error(
          `Scenario ${b.scenario_id}: samples must be consecutive at ${step} s; include blank disconnect markers for gaps.`,
        );
      if (b.device_id !== a.device_id)
        throw new Error("Do not mix devices in one scenario.");
    }
  return { phase, samples };
}
export const number = (row: Sample, key: string): number | null =>
  typeof row[key] === "number" ? (row[key] as number) : null;
