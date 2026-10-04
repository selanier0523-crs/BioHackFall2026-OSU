# NG Tube Assistant

An installable, mobile-first React/TypeScript application for the BioHack synthetic NG-tube demonstration. Patients, checks, feeding, pump controls, and hospital communication are fictional. Mock login and role switching do not secure data.

## Run

Node.js 22 or newer is recommended. From this directory:

```powershell
npm ci
npm test
npm run build
npm run preview -- --port 4173
```

Open http://localhost:4173. Development: `npm run dev`. Browser verification against the production preview: `npx playwright install chromium`, then `npm run test:browser`. The cloud browser test needs the supplied Supabase project configured; other tests explicitly use local mode.

The `.env.local` file on this machine contains the supplied public URL and publishable key. It is ignored by Git. Copy `.env.example` to `.env.local` on another machine and fill in those values. Vite accepts the supplied `NEXT_PUBLIC_SUPABASE_*` names. `@supabase/supabase-js` and `@supabase/ssr` are installed and version-pinned. This app is a client-side React app with **mock** login, so it does not use Next.js cookie helpers, authentication middleware, registration, or a `todos` table.

For a deliberately local demo, open http://localhost:4173/?local. This disables cloud requests while preserving the entire CSV workflow.

## Walk through the demonstration

1. Enter `caregiver` / `123`, or select **Enter caregiver demo**. Clinician credentials are `clinician` / `123`.
2. Select **Insert or replace NG tube**. The default P01 fixture collects 50 consecutive samples. **Demo controls** chooses other fixtures and playback speeds.
3. Open **Help & tutorial** whenever needed. Favorable readings show the limits of the sensor assessment. Check the fictional clinical-confirmation acknowledgment, then **Continue demo**.
4. Choose a feeding plan and separate feeding fixture, then **Start simulated feed**. F01 measures 30 mL over 1,800 sensor seconds; at 20× replay this takes roughly 90 seconds. The original timestamps are preserved.
5. Pause/resume/stop controls change only the simulated session. Replay controls move the prerecorded stream. On a major warning, the simulated session stops but replay continues for inspection. Acknowledging keeps the warning visible.
6. Later feeds use **Check tube before feeding**, requiring a fresh sensor window and another fictional confirmation. Previously consumed checks cannot start another feed. Tube insertion state persists.
7. Switch to **Clinician** to edit times, amounts, rates, instructions, reminders, or tutorial assignments. Both views use the same simulation and records. **History** contains source timestamps, placement measurements, sessions, missing-data indicators, alerts, and acknowledgment history.

The demonstration clock begins five minutes before the first fictional order. It advances by sensor time independently of historical timestamps. Reminders are in-app labels, with no notifications or background monitoring. On refresh, playback resumes **paused at the saved position**; the active simulation’s session record is retained until the user resumes or ends it.

## Sensor calculations

`src/csv.ts` parses input-only measurement files, preserving blanks as null and source UTC timestamps. Upload replacement placement or feeding CSVs using the supplied headers. Each file can contain several scenarios, which are isolated. Numbers, flags, field counts, stream identifiers, 5 Hz/1 Hz timing, and consecutive timestamps are validated. Include explicit disconnected rows for missing intervals. Unsupported timing and malformed files produce visible errors.

`src/analysis.ts` implements the documented model using `settings.csv`. Analysis is transport-independent and consumes measured fields only. Expected labels, scenario labels, and ground-truth annotations never control a live assessment. Identical P01/P05 readings produce identical assessments.

Placement uses 50 consecutive valid samples and counts repeated CO₂ threshold crossings. Feeding uses consecutive trailing windows, sensor-time persistence, the documented priority, and a scenario-latched obstruction state. Pressure correction follows proximal height minus distal height. Known volume is integrated from measured distal interval flow; missing intervals stay separate. The zero-proximal-flow mismatch fraction is undefined/null, matching the supplied metrics.

Replay analysis and simulated delivery records are intentionally separate. The analysis sees all prerecorded rows. Session volume only counts measured intervals while that simulated feed is running. Fixture command rates are prerecorded; editing a plan does not alter the raw fixture measurements. A fixture ending early creates a stopped, incomplete session, not a completed prescribed feed.

## Supabase persistence

The supplied project `tqiisddkoekbsfbfndem` has the migration applied and synthetic patient/device seed records installed. `supabase/migrations/20261003223101_ng_demo_storage.sql` reproduces the schema; `supabase/seed.sql` is idempotent. For a new project, run the migration in its SQL editor and then the seed. The CSV care plans and resources initialize the shared snapshot on the first app load.

Only `public.ng_demo_records` is used, restricted to `BIOHACK-SYNTHETIC-DEMO` and `synthetic = true`. RLS is enabled. Explicit select/insert/update policies allow the public synthetic demonstration; anonymous delete is not granted. No other tables or policies are altered. Anyone with the public demo connection can access its fictional records; never store real patient data here.

Record kinds cover patient, device, plans, placement checks, feeding sessions, alerts (including acknowledgment history), tutorial assignments/completion, sensor batches, and a versioned snapshot. UUID sessions and stable record keys make reconnect upserts idempotent. The snapshot includes shared simulation position, windows, and uploaded data. Original sensor timestamps are retained.

Local storage is written immediately. A three-second foreground polling mechanism synchronizes through Supabase; no Auth session is created. The UI reports connecting, locally saved, pending synchronization, synchronized, and revision-conflict states. Offline changes queue locally. Snapshot writes use a revision compare-and-swap, so concurrent stale clients do not silently overwrite shared updates. On conflict, export the local copy if needed, then **Load shared demo**. All displays distinguish this database from a hospital chart.

Reset clears the current shared demo snapshot. Historical individual database records remain as synthetic archival records; only the current snapshot is shown in the app. No browser secret/service-role key is used.

## Android installation and offline access

1. Host the built `dist` directory on an **HTTPS** static host, serving the app at the domain root. The localhost preview is a desktop development environment; a phone’s plain LAN HTTP URL is not a secure installation context.
2. Open the HTTPS URL in Chrome on Android. Wait for the first full production load and offline cache installation.
3. Browser menu → **Install app** or **Add to Home screen**. Launch it from the home screen to use a standalone window.

The manifest includes 192/512 PNG icons, a maskable icon, start URL, scope, colors, and standalone display. The build creates a content-versioned service worker, syntax-checks it, and precaches the app shell and all supplied CSVs. After the first load, offline refresh, help, bundled fixtures, and local persistence work. Offline availability applies to the production build, not the Vite development server. Cloud sync requires internet and an open app; there is no background sensor monitoring. Updates install a new cache and take effect when existing app windows close and reopen.

See [Chrome installation guidance](https://web.dev/learn/pwa/installation) for browser installation behavior.

## Optional Arduino USB

Read-only Web Serial placement ingestion is available in capable, secure-context browsers. See [ARDUINO.md](ARDUINO.md) for packets, timing, errors, and compatibility. No physical pump commands are sent. CSV is the fully verified feeding path. Bluetooth remains a future transport adapter, with no simulated connection represented as real.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for the reference comparison and browser checks. Android installation on a physical handset and real Arduino hardware have not been exercised. Hospital/EHR integration and educational videos are explicitly simulated placeholders.
