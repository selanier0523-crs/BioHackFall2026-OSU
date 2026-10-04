import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv, parseSensors, type Sample } from "../src/csv";
import {
  initialAnalysis,
  stepFeeding,
  stepPlacement,
  calculate,
  type Settings,
} from "../src/analysis";
const read = (name: string) => readFileSync(`public/data/${name}.csv`, "utf8");
const settings: Settings = Object.fromEntries(
  parseCsv(read("settings")).map((v) => [v.parameter, Number(v.value)]),
);
const placement = parseSensors(read("placement_inputs")).samples,
  feeding = parseSensors(read("feeding_inputs")).samples;
describe("CSV sensor-only algorithms against every supplied reference", () => {
  it("loads 17 scenarios and 5040 records; quoting and blanks preserve null", () => {
    expect(placement.length + feeding.length).toBe(5040);
    expect(
      new Set([...placement, ...feeding].map((r) => r.scenario_id)).size,
    ).toBe(17);
    expect(
      feeding.find((r) => r.connected === 0)?.distal_flow_ml_hr,
    ).toBeNull();
    expect(parseCsv('a,b\n"x,y","a\n""b"""')[0]).toEqual({
      a: "x,y",
      b: 'a\n"b"',
    });
  });
  it("matches 1800 placement state references", () => {
    const expected = parseCsv(read("placement_expected"));
    let a = initialAnalysis(),
      id = "";
    const mismatches: string[] = [];
    placement.forEach((r, i) => {
      if (id !== r.scenario_id) {
        a = initialAnalysis();
        id = r.scenario_id;
      }
      a = stepPlacement(a, r, settings);
      if (a.state !== expected[i].expected_demo_state)
        mismatches.push(
          `${id} t=${r.elapsed_s}: ${a.state} vs ${expected[i].expected_demo_state}`,
        );
    });
    expect(mismatches).toEqual([]);
  });
  it("matches 3240 feeding state references", () => {
    const expected = parseCsv(read("feeding_expected"));
    let a = initialAnalysis(),
      id = "";
    const mismatches: string[] = [];
    feeding.forEach((r, i) => {
      if (id !== r.scenario_id) {
        a = initialAnalysis();
        id = r.scenario_id;
      }
      a = stepFeeding(a, r, settings, 30);
      if (a.state !== expected[i].expected_demo_state)
        mismatches.push(
          `${id} t=${r.elapsed_s}: ${a.state} vs ${expected[i].expected_demo_state}`,
        );
    });
    expect(mismatches).toEqual([]);
  });
  it("matches every supplied gravity, flow, pressure and volume metric", () => {
    const expected = parseCsv(read("feeding_metrics"));
    let a = initialAnalysis(),
      id = "";
    const keys = {
      gravity_head_kpa: "gravity",
      flow_difference_ml_hr: "difference",
      flow_difference_fraction: "fraction",
      corrected_pressure_drop_kpa: "corrected",
      extra_pressure_kpa: "extra",
      interval_delivered_ml: "intervalVolume",
      known_delivered_ml: "knownVolume",
      missing_intervals: "missingIntervals",
    } as const;
    feeding.forEach((r, i) => {
      if (id !== r.scenario_id) {
        a = initialAnalysis();
        id = r.scenario_id;
      }
      a = stepFeeding(a, r, settings);
      for (const [csv, key] of Object.entries(keys)) {
        const value = expected[i][csv];
        if (value === "")
          expect(a.metrics[key], `${id} ${r.elapsed_s} ${csv}`).toBeNull();
        else
          expect(a.metrics[key], `${id} ${r.elapsed_s} ${csv}`).toBeCloseTo(
            Number(value),
            8,
          );
      }
    });
  });
  it("identical stomach and acid reflux inputs give identical assessment sequences", () => {
    const run = (id: string) => {
      let a = initialAnalysis();
      return placement
        .filter((r) => r.scenario_id === id)
        .map((r) => {
          a = stepPlacement(a, r, settings);
          return a.state;
        });
    };
    expect(run("P01")).toEqual(run("P05"));
  });
  it("replay batching at 1×, 5×, and 20× preserves every assessment and integrated volume", () => {
    for (const id of new Set(feeding.map((r) => r.scenario_id))) {
      const rows = feeding.filter((r) => r.scenario_id === id);
      const run = (batch: number) => {
        let a = initialAnalysis();
        for (let i = 0; i < rows.length; i += batch)
          for (const r of rows.slice(i, i + batch))
            a = stepFeeding(a, r, settings, 30);
        return a;
      };
      expect(run(1)).toEqual(run(5));
      expect(run(1)).toEqual(run(20));
    }
  });
  it("never uses scenario names, truth or expected labels", () => {
    const r = placement.find((r) => r.scenario_id === "P01")!;
    const a = stepPlacement(initialAnalysis(), r, settings);
    expect(
      stepPlacement(
        initialAnalysis(),
        {
          ...r,
          scenario_id: "AIRWAY",
          truth_location: "airway",
          expected_demo_state: "POSSIBLE_AIRWAY",
        } as Sample,
        settings,
      ),
    ).toEqual({
      ...a,
      window: [
        {
          ...r,
          scenario_id: "AIRWAY",
          truth_location: "airway",
          expected_demo_state: "POSSIBLE_AIRWAY",
        },
      ],
    });
  });
  it("rejects missing columns, invalid numbers, flags and time gaps", () => {
    for (const text of [
      "ph\n3",
      "scenario_id,device_id,timestamp_utc,elapsed_s,sample_interval_s,ph,co2_mmhg,connected,ph_valid,co2_valid\nP,D,2026-01-01T00:00:00Z,0,0.2,no,0,1,1,1",
    ])
      expect(() => parseSensors(text)).toThrow();
    const input = read("placement_inputs").replace(",1,1,1", ",2,1,1");
    expect(() => parseSensors(input)).toThrow();
  });
  it("handles zero commanded flow without divide by zero", () => {
    const r = feeding.find(
      (v) => v.scenario_id === "F09" && v.pump_state === "PAUSED",
    )!;
    expect(calculate(r, settings).fraction).toBeNull();
  });
});
