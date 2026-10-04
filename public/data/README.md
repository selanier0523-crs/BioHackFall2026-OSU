# NG app demonstration dataset

## Scope
All measurements, people, devices and orders are synthetic. Intended for a BioHack app demo, not clinical use or algorithm validation.

## Replay
Choose one scenario_id. Sort by elapsed_s. Replay Placement every 200 ms or Feeding every 1 s, optionally accelerated. Reset all windows and accumulators at scenario boundaries.

## Input vs answer key
Use measured fields and quality flags as app inputs. expected_demo_state and truth_location/truth_event are answer-key annotations; never feed these into the detection algorithm.

## Sample timing
Placement has 225 point samples at 0.0–44.8 s. Feeding has one-second interval means, timestamps at interval END, t=1 through duration. UTC is used throughout.

## Connection
Rows during a disconnect are replay timeline markers; their measurement cells are blank. A real Bluetooth implementation would infer these gaps from timeouts.

## Missing vs zero
Blank means unavailable. Zero is a measured zero, including a stopped or paused feed. Never replace blanks with zero when deciding placement or delivery status.

## Placement limit
Low pH plus no respiratory waveform cannot uniquely identify stomach location. P01 and P05 intentionally share readings but different truth. GASTRIC_COMPATIBLE is not permission to feed.

## Placement algorithm
50 valid consecutive samples. Count CO2 upward crossings of 3 mmHg within the window. At least 2 => POSSIBLE_AIRWAY. Otherwise any high CO2 => INCONCLUSIVE_CO2.

## Placement continuation
If no CO2 above threshold, all pH samples from 1 through 5.5 => GASTRIC_COMPATIBLE; otherwise PLACEMENT_UNCERTAIN. Invalid current packet => SENSOR_UNAVAILABLE; incomplete valid window => COLLECTING.

## CO2 meaning
co2_mmhg is gas partial pressure, not blood CO2 and not percent. A normal respiratory peak is only a waveform reference. Weak or absent CO2 does not exclude airway placement or aspiration.

## pH meaning
ph is a hypothetical calibrated distal liquid-contact sensor reading. No claim that research on aspirated fluid validates this sensor. Dry contact should be marked invalid by future hardware.

## Feeding context
Feeding scenarios are separate fixtures with fictional prior protocol confirmation. No feeding session is automatically unlocked by these placement values. All tubing is assumed primed.

## Gravity sign
height_prox_minus_dist_m = proximal sensor height minus distal sensor height. Positive means pump outlet above distal sensor. gravity_head_kpa = density*g*height/1000.

## Pressure model
corrected_pressure_drop = Pprox - Pdist + gravity_head. Expected clean-tube loss = baseline_resistance * measured proximal flow. extra_pressure = corrected loss - expected clean loss.

## Model scope
Quasi-steady, water-like liquid, comparable velocities and no kinetic-head correction. Pressure sensors are downstream of the pump and near the tube exit. Both are gauge pressures referenced to atmosphere.

## Gravity interpretation
Raising the pump reduces the proximal pressure required at constant flow. Lowering it increases required proximal pressure. Negative proximal gauge pressure can occur in this idealized occlusive-pump model.

## Flow continuity
A filled intact tube has approximately equal proximal and distal mean flows, even during steady obstruction. Sustained mismatch represents leakage, storage/compliance or measurement error.

## Complete obstruction
F05 briefly allows slight proximal inflow while pressure rises, representing tiny compliance storage. Both flows then become zero. Commanded flow is distinct from actual measured flow.

## Feeding algorithm
Use 10 valid consecutive one-second samples and trailing means. Excess pressure >5 kPa for 10 evaluated windows => HIGH_RESISTANCE, or POSSIBLE_OBSTRUCTION if distal flow <80% of command.

## Feeding continuation
Mean distal <1 mL/hr AND mean excess pressure >10 kPa for 5 evaluated windows => latched OBSTRUCTION_ALERT. Absolute mean-flow mismatch >15% for 10 evaluated windows => DELIVERY_MISMATCH.

## Priority
Current missing packet first; then latched obstruction; then intentional PAUSED; then full-window requirement; severe obstruction; high resistance/possible obstruction; delivery mismatch; MONITOR during persistence; otherwise FEEDING_NORMAL.

## Window reset
A current missing packet resets persistence counters; require 10 consecutive valid samples after reconnect. Pause resets persistence counters. Obstruction remains latched for the rest of its scenario.

## Volume
interval_delivered_ml = distal_flow*interval_s/3600. known_delivered_ml sums only valid intervals. missing_intervals >0 means the session total is incomplete; do not label it fully delivered.

## Completion
Only F01 reaches its fictional 30 mL target; its last interval has DEMO_FEED_COMPLETE. Other feeding fixtures stop at 180 s for testing and do not represent complete prescribed feeds.

## Formulas vs labels
Q:X on Feeding and duration on CarePlan are live Excel formulas. Synthetic raw data and expected labels are fixed fixtures. Changing Settings recalculates formulas, not the prerecorded status labels.

## No universal pressure
The cited commercial pump pressure is an equipment alarm specification, not normal patient pressure or a safe threshold for this design. Absolute pressures and toy warning thresholds here are assumptions.

## Units and precision
Flow mL/hr; pressure kPa gauge; CO2 mmHg; height m; time s; density kg/m3; volume mL. Decimal precision makes the replay reproducible, not a claim about sensor accuracy.

## Reproducibility
No random generator: deterministic sine noise and piecewise waveforms. Feeding ripple ±0.6 mL/hr; pressure offset ripple ±0.02 kPa; gastric pH ripple ±0.08. No patient observations were copied.

## Bluetooth interface
device_id, timestamp_utc, values and validity flags define a transport-neutral packet. This workbook simulates connection state and measurements; it does not implement BLE or a device protocol.

## Care coordination
CarePlan provides fictional schedules, volumes, rates, reminder lead times and education titles. Blank education_url requires a clinician-approved resource. No videos are embedded.

## EHR interface
MOCK_PENDING is a demo label. Event summaries can contain plan/device IDs, times, known volume, missing-data flag and alert history. No real chart integration or FHIR conformance is claimed.

## CSV files
The ZIP includes raw input-only sensor tables, derived feeding metrics, separate expected labels, scenarios, settings, care plan and source references. Empty CSV fields are null, timestamps ISO 8601 UTC.

## Scenario row references
Scenarios gives the first/last Excel row for each fixture. These references describe the delivered ordering; preserve rows or use scenario_id after sorting.

## Clinical boundary
Never display a clinical placement pass or automated feeding clearance from this unvalidated model. A production design requires device-specific testing and a validated clinical confirmation workflow.
