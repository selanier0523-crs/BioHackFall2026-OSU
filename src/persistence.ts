import { createClient } from "@supabase/supabase-js";
import {
  acceptRemote,
  onDurableChange,
  setRevision,
  store,
  type DemoState,
} from "./store";
const localOnly = new URLSearchParams(location.search).has("local");
const url = localOnly ? undefined : import.meta.env.NEXT_PUBLIC_SUPABASE_URL,
  key = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;
const workspace = "BIOHACK-SYNTHETIC-DEMO";
const table = "ng_demo_records";
const DIRTY = "ng-demo-pending";
let pending = localStorage.getItem(DIRTY) === "1",
  busy = false,
  initialized = false,
  conflict = false;
let status = supabase
  ? "Saved locally · connecting to Supabase"
  : "Saved locally · Supabase not configured";
const listeners = new Set<() => void>();
export const syncStore = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
const message = (s: string) => {
  status = s;
  listeners.forEach((fn) => fn());
};
const setPending = (value: boolean) => {
  pending = value;
  localStorage.setItem(DIRTY, value ? "1" : "0");
};
function records(s: DemoState) {
  return [
    {
      id: "patient",
      kind: "patient",
      payload: { id: "DEMO-PATIENT-01", name: "Demo Patient", synthetic: true },
    },
    {
      id: "device",
      kind: "device",
      payload: { id: "DEMO-DEVICE-01", synthetic: true },
    },
    ...s.plans.map((v) => ({ id: v.id, kind: "plan", payload: v })),
    ...s.assignments.map((v) => ({ id: v.id, kind: "assignment", payload: v })),
    ...s.checks.map((v) => ({ id: v.id, kind: "check", payload: v })),
    ...s.alerts.map((v) => ({ id: v.id, kind: "alert", payload: v })),
    ...s.sessions.flatMap((v) => [
      { id: v.id, kind: "session", payload: { ...v, records: undefined } },
      {
        id: `batch:${v.id}`,
        kind: "sensor_batch",
        payload: { sessionId: v.id, records: v.records },
      },
    ]),
  ].map((v) => ({ ...v, workspace, synthetic: true, revision: 0 }));
}
export async function synchronize() {
  if (!supabase || busy || conflict) return;
  busy = true;
  try {
    if (!navigator.onLine) throw new Error("Offline");
    const { data: remote, error: readError } = await supabase
      .from(table)
      .select("payload,revision")
      .eq("workspace", workspace)
      .eq("id", "snapshot")
      .maybeSingle();
    if (readError) throw readError;
    if (!initialized) {
      if (remote && !pending)
        acceptRemote(remote.payload as DemoState, remote.revision);
      else if (!remote) setPending(true);
      initialized = true;
    }
    if (pending) {
      const s = structuredClone(store.get()),
        expected = s.revision;
      if (remote && remote.revision !== expected) {
        conflict = true;
        message(
          "Saved locally · synchronization conflict. Load shared demo or keep local copy.",
        );
        return;
      }
      const next = {
        workspace,
        id: "snapshot",
        kind: "snapshot",
        synthetic: true,
        payload: { ...s, role: null, playing: false },
        revision: expected + 1,
      };
      const query = remote
        ? supabase
            .from(table)
            .update(next)
            .eq("workspace", workspace)
            .eq("id", "snapshot")
            .eq("revision", expected)
            .select("revision")
        : supabase.from(table).insert(next).select("revision");
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) throw new Error("Concurrent change; retrying.");
      // Record the successful compare-and-swap even if a subsequent batch write fails.
      setRevision(expected + 1);
      // Individual records are stable upserts, so reconnect never duplicates sessions/events.
      const { error: recordsError } = await supabase
        .from(table)
        .upsert(records(s), { onConflict: "workspace,id" });
      if (recordsError) throw recordsError;
      const stillSame =
        JSON.stringify({ ...store.get(), revision: 0, role: null }) ===
        JSON.stringify({ ...s, revision: 0, role: null });
      setPending(!stillSame);
    } else if (remote && remote.revision > store.get().revision)
      acceptRemote(remote.payload as DemoState, remote.revision);
    message(
      pending
        ? "Saved locally · pending Supabase synchronization"
        : "Synchronized with Supabase · synthetic demo only",
    );
  } catch (error) {
    message(
      `Saved locally · pending synchronization (${error instanceof Error ? error.message : ((error as { message?: string }).message ?? "connection unavailable")})`,
    );
  } finally {
    busy = false;
  }
}
export async function loadSharedDemo() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(table)
    .select("payload,revision")
    .eq("workspace", workspace)
    .eq("id", "snapshot")
    .single();
  if (error) {
    message(error.message);
    return;
  }
  acceptRemote(data.payload as DemoState, data.revision);
  setPending(false);
  conflict = false;
  initialized = true;
  message("Synchronized with Supabase · shared demo loaded");
}
export function startPersistence() {
  onDurableChange(() => {
    setPending(true);
    message(
      supabase
        ? "Saved locally · pending Supabase synchronization"
        : "Saved locally · Supabase not configured",
    );
  });
  if (!supabase) return;
  void synchronize();
  setInterval(() => void synchronize(), 3000);
  window.addEventListener("online", () => void synchronize());
}
