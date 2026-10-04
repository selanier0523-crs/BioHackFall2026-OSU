# Verification

Verified on October 3, 2026 using the production preview, Chromium desktop automation, and a 390 × 844 mobile viewport.

## Deterministic reference comparisons

`npm test` exercises the actual CSV files and measured-field algorithm. All checks pass:

- 17 scenarios and 5,040 parsed measurements.
- All 1,800 placement assessment rows match `placement_expected.csv`.
- All 3,240 feeding assessment rows match `feeding_expected.csv`.
- Every feeding gravity head, flow difference, mismatch fraction, corrected pressure, extra pressure, interval volume, cumulative known volume, and missing count matches `feeding_metrics.csv` to 8 decimal places.
- Identical P01/P05 streams have identical assessment sequences; truth/scenario labels do not drive detection.
- Batching at 1×, 5×, and 20× produces identical calculations and final analysis windows/counters.
- Null readings remain unavailable; zero-proximal-flow fractions are null rather than infinity or zero. Intentional pauses avoid false obstruction.
- CSV quoted fields, missing columns, malformed numeric data and invalid flags are checked.

An initial metric discrepancy at zero proximal flow was investigated and fixed: the reference leaves the fraction blank because its denominator is zero. The algorithm never uses expected labels as inputs.

## Browser workflow checks

`npm run test:browser` exercises seven end-to-end tests against the built preview:

- Both credential pairs, invalid credential feedback, convenient entry buttons and caregiver/clinician switching without resetting position.
- Insertion assistance, direct help access, fictional acknowledgment gating, normal full 30 mL feed, and a subsequent abbreviated check with insertion state retained.
- Fresh checks cannot be reused. Session pause/resume/stop, refresh persistence and intentionally paused replay after refresh.
- Airway, weak airway, neutral/raised pH, acid reflux, and disconnected placement fixtures.
- Clinician plan editing, shared caregiver instructions, searchable tutorials, assignment and viewed completion.
- Fault stops, continued prerecorded playback after the simulation stops, latched obstruction, acknowledgment retaining the warning, and direct alert help.
- Browser replay of raised/lowered pump height, partial obstruction, flow mismatch, dropout, maintained-flow resistance, and intentional pause.
- Valid CSV upload, invalid-file feedback, mobile width checks, offline production reload and bundled readings, standalone manifest and icons.
- Actual Supabase synchronization across independent browser contexts, refresh, offline queued plan editing, and reconnect propagation.

The complete-feed browser test advances the browser clock while processing each sensor interval; it does not inject a fabricated completion result. No page runtime errors occur in the primary workflow.

Two real offline defects were found and repaired: a service-worker generator syntax error, and static-cache misses caused by the preview server's `Vary: Origin` header. The production build now syntax-checks its generated worker. Offline reload was verified after the fixes.

## Database checks

- Migration applied to the supplied project. Exposed demo table has RLS enabled; only named synthetic workspace policies are installed.
- Supabase security advisor returned no findings after migration.
- Actual publishable-key writes and reads, repeated stable-key session upserts, missing-data persistence, workspace isolation, and synthetic-only constraints are verified by `node --env-file=.env.local tests/cloud-storage.mjs`.
- Browser tests change a fictional plan and restore its original instructions after verifying propagation and offline reconnect. A clearly marked synthetic storage-verification session remains in the isolated records table; it is not included in the active demo snapshot.

## Limits

Actual physical Android installation, Arduino USB permissions/disconnection on a real device, and live hardware signal accuracy were not tested. Web Serial is optional and limited to read-only placement assistance; live USB feeding sessions are not enabled. CSV feeding is fully verified.

Educational videos, clinical confirmation, pump actions, patients and hospital/EHR communication remain explicitly fictional. The sensor model is an unvalidated demonstration, not a clinical clearance system. Cloud synchronization uses foreground polling; there is no background monitoring, authenticated patient access, notification service, or hospital chart integration.
