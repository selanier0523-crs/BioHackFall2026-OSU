# Arduino USB packet contract

This optional adapter reads sensors only. The app's feeding controls never send hardware commands. Real Arduino hardware and Android USB have not been tested. CSV remains the required, fully working input path; live USB is limited to optional placement assistance and inspection. To simulate a feeding session, switch the data source back to CSV and collect a fresh check.

Open **Demo controls → Arduino USB → Connect USB** in a browser that exposes `navigator.serial` in a secure context. Connection requires a user gesture and browser permission. Baud rate defaults to 115200 and is configurable. Cancellation, disconnects, malformed packets, waiting, stale data, and unsupported browsers are displayed. Every packet ends with a newline; maximum buffered line length is 64 KB.

Packets use `phase: "Placement"` plus the exact CSV names and units:

```json
{"phase":"Placement","scenario_id":"USB-PLACEMENT-01","device_id":"DEMO-ARDUINO-01","timestamp_utc":"2026-10-03T20:00:00.000Z","elapsed_s":0,"sample_interval_s":0.2,"ph":3.2,"co2_mmhg":0.3,"connected":1,"ph_valid":1,"co2_valid":1}
```

Send at 5 Hz; timestamps and elapsed time increase by 0.2 s. `ph` is a fictional calibrated distal liquid-contact measurement, not a validated aspirate test. `co2_mmhg` is gas partial pressure. Flags are numeric 0/1. Unavailable measurements are JSON null, never substituted zero. A new device/stream requires disconnecting and reconnecting, clearing the analysis window. The workflow must match the packet phase. Duplicate, out-of-order, incorrect phase, and timing-gap packets are rejected. After more than two seconds without a packet, readings become stale/unavailable and fresh window collection is required; reconnect after such a gap.

The transport-neutral feeding packet shape, for future hardware integration/testing, uses one-second interval means timestamped at interval END:

```json
{"phase":"Feeding","scenario_id":"USB-FEED-01","device_id":"DEMO-ARDUINO-01","timestamp_utc":"2026-10-03T20:00:01.000Z","elapsed_s":1,"interval_s":1,"commanded_flow_ml_hr":60,"proximal_flow_ml_hr":60,"distal_flow_ml_hr":60,"proximal_pressure_kpa":0.97,"distal_pressure_kpa":1,"height_prox_minus_dist_m":0.3,"connected":1,"sensors_valid":1,"pump_state":"RUNNING"}
```

Flow is mL/hr, pressure is kPa gauge referenced to atmosphere, and height is proximal minus distal in meters. Pump states can be RUNNING, PAUSED, STOPPED, or STOPPED_FAULT. A compatible future adapter can pass validated measurements to `processSample` and the same analysis functions; no algorithm depends on transport or on truth labels. Live feeding sessions are deliberately not enabled in the current optional USB adapter.

Chrome desktop and other Chromium environments can expose [Web Serial](https://developer.chrome.com/docs/capabilities/serial). Android support is not universal. Chrome's documentation describes Android USB serial approaches through [WebUSB](https://developer.chrome.com/docs/capabilities/usb), but these require device-specific serial drivers/polyfills, USB descriptors, permission, and often an OTG-capable device. This app does not include an unverified USB polyfill or claim phone compatibility. Safari/iOS, Firefox, or any browser without `navigator.serial` receives the unsupported state and can use CSV replay.
