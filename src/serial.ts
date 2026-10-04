import {
  feedingColumns,
  placementColumns,
  parseSensors,
  type Phase,
  type Sample,
} from "./csv";
import {
  currentScenario,
  endSession,
  processSample,
  store,
  update,
} from "./store";
import { initialAnalysis } from "./analysis";
type Port = {
  open: (o: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};
type Serial = { requestPort: () => Promise<Port> };
let port: Port | null = null,
  reader: ReadableStreamDefaultReader<Uint8Array> | null = null,
  lastPacket = 0,
  timer: ReturnType<typeof setInterval> | null = null,
  previous: Sample | null = null;
export const serialSupported = () =>
  "serial" in navigator && window.isSecureContext;
export function parsePacket(line: string) {
  const packet = JSON.parse(line);
  if (!["Placement", "Feeding"].includes(packet.phase))
    throw new Error("Packet needs phase Placement or Feeding.");
  const phase = packet.phase as Phase,
    columns = phase === "Placement" ? placementColumns : feedingColumns;
  const csv =
    columns.join(",") +
    "\n" +
    columns
      .map((k) => '"' + String(packet[k] ?? "").replaceAll('"', '""') + '"')
      .join(",");
  return { phase, row: parseSensors(csv).samples[0] };
}
function missingMarker(phase: Phase): Sample {
  const step = phase === "Placement" ? 0.2 : 1;
  return {
    scenario_id: previous?.scenario_id ?? "USB",
    device_id: previous?.device_id ?? "USB",
    timestamp_utc: new Date(
      previous ? Date.parse(previous.timestamp_utc) + step * 1000 : Date.now(),
    ).toISOString(),
    elapsed_s: (previous?.elapsed_s ?? -step) + step,
    sample_interval_s: 0.2,
    interval_s: 1,
    connected: 0,
    ph_valid: 0,
    co2_valid: 0,
    sensors_valid: 0,
    pump_state: "RUNNING",
  };
}
function ingest(row: Sample, phase: Phase) {
  const scenario = currentScenario();
  if (scenario.phase !== phase)
    throw new Error(
      `Expected ${scenario.phase} packets. Change workflow phase first.`,
    );
  const step = phase === "Placement" ? 0.2 : 1;
  if (previous) {
    if (
      row.scenario_id !== previous.scenario_id ||
      row.device_id !== previous.device_id
    )
      throw new Error(
        "Device/stream changed. Disconnect and reconnect to reset the window.",
      );
    const delta = row.elapsed_s - previous.elapsed_s;
    if (delta < step - 1e-5)
      throw new Error("Duplicate or out-of-order packet.");
    if (
      delta > step + 1e-5 ||
      Math.abs(
        (Date.parse(row.timestamp_utc) - Date.parse(previous.timestamp_utc)) /
          1000 -
          delta,
      ) > 1e-3
    )
      throw new Error("Packet timing gap: reconnect with consecutive samples.");
  }
  const id = scenario.id;
  const uploads = store
    .get()
    .uploads.map((v) =>
      v.id === id ? { ...v, samples: [...v.samples, row].slice(-10000) } : v,
    );
  update({ uploads }, false);
  processSample(row, phase);
  update({ serialStatus: "Connected · receiving sensor packets", error: "" });
  previous = row;
  lastPacket = Date.now();
}
export async function connectSerial(baudRate: number) {
  if (!serialSupported()) {
    update({ serialStatus: "Unsupported browser. Use CSV replay." });
    return;
  }
  try {
    await disconnectSerial();
    port = await (
      navigator as Navigator & { serial: Serial }
    ).serial.requestPort();
    await port.open({ baudRate });
    const phase = currentScenario().phase,
      id = `USB-${crypto.randomUUID()}`;
    endSession("Ended to change sensor input.");
    update({
      sourceMode: "serial",
      scenarioId: id,
      uploads: [
        ...store.get().uploads,
        {
          id,
          phase,
          label: "Arduino USB",
          note: "Live sensor ingestion; all app actions remain simulated.",
          source: "Arduino USB · read only",
          samples: [],
        },
      ],
      index: 0,
      playing: false,
      analysis: initialAnalysis(),
      readyCheckId: null,
      checkKind: null,
      serialStatus: "Connected · waiting for packets",
    });
    previous = null;
    lastPacket = Date.now();
    timer = setInterval(() => {
      if (Date.now() - lastPacket > 2000) {
        const row = missingMarker(phase);
        try {
          ingest(row, phase);
          update({ serialStatus: "Stale data · readings unavailable" });
        } catch {
          update({
            serialStatus: "Stale data · reconnect required",
            analysis: { ...initialAnalysis(), state: "SENSOR_UNAVAILABLE" },
          });
        }
      }
    }, 1000);
    reader = port.readable!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 65536) throw new Error("USB packet exceeds 64 KB.");
      let split: number;
      while ((split = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, split).trim();
        buffer = buffer.slice(split + 1);
        if (!line) continue;
        try {
          const packet = parsePacket(line);
          ingest(packet.row, packet.phase);
        } catch (e) {
          update({
            error: `USB packet rejected: ${(e as Error).message}`,
            analysis: { ...initialAnalysis(), state: "SENSOR_UNAVAILABLE" },
          });
          endSession("Stopped because a USB packet was invalid.");
        }
      }
    }
  } catch (e) {
    update({
      error: `USB connection ended or permission refused: ${(e as Error).message}`,
      serialStatus: `Disconnected: ${(e as Error).message}`,
      analysis: { ...initialAnalysis(), state: "SENSOR_UNAVAILABLE" },
    });
    endSession("USB input disconnected.");
  } finally {
    await disconnectSerial();
  }
}
export async function disconnectSerial() {
  if (timer) clearInterval(timer);
  timer = null;
  const oldReader = reader;
  reader = null;
  if (oldReader) {
    try {
      await oldReader.cancel();
      oldReader.releaseLock();
    } catch {
      /* device removed */
    }
  }
  if (port) {
    try {
      await port.close();
    } catch {
      /* already closed */
    }
  }
  port = null;
  previous = null;
  if (store.get()) update({ serialStatus: "Disconnected" });
}
