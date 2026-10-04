import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Pause,
  Play,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { statusText, stopStates } from "./analysis";
import {
  activeSession,
  beginCheck,
  confirmCheck,
  currentScenario,
  demoDate,
  pump,
  recordFailedCheck,
  startFeed,
  update,
  type DemoState,
  type Plan,
} from "./store";

function FeedingReminder({
  plan,
  s,
  feeding = false,
}: {
  plan: Plan;
  s: DemoState;
  feeding?: boolean;
}) {
  const until = (Date.parse(plan.time) - demoDate(s).getTime()) / 60000;
  const scheduled = new Date(plan.time);
  const time = scheduled
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s/g, "");
  return (
    <section className="feeding-reminder" aria-label="Feeding reminder">
      <div className="spread">
        <h2>Feeding plan</h2>
        {!feeding && (
          <span className="pill" role="status">
            {until <= 0
              ? "Feeding due"
              : until <= plan.reminder
                ? `Feeding in ${Math.ceil(until)} min`
                : `Reminder ${plan.reminder} min before`}
          </span>
        )}
      </div>
      <p className="feeding-schedule">
        <strong>{time}</strong> ·{" "}
        {scheduled.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}{" "}
        <small>Local time · demo schedule</small>
      </p>
      <div className="numbers">
        <div>
          <strong>
            {plan.volume}
            <small> mL</small>
          </strong>
          <span>Amount</span>
        </div>
        <div>
          <strong>
            {plan.rate}
            <small> mL/hr</small>
          </strong>
          <span>Rate</span>
        </div>
        <div>
          <strong>
            {Math.ceil((plan.volume / plan.rate) * 60)}
            <small> min</small>
          </strong>
          <span>Planned duration</span>
        </div>
      </div>
      <h3>Instructions from Clinician</h3>
      <p className="caregiver-instructions">
        {plan.instructions || "No instructions added."}
      </p>
      {!feeding && (
        <p className="feeding-steps">
          Check tube placement and complete the required confirmation before
          selecting Start feeding.
        </p>
      )}
    </section>
  );
}

export default function CaregiverWorkflow({ s }: { s: DemoState }) {
  const [confirmed, setConfirmed] = useState(false);
  const active = activeSession();
  const last = s.sessions.at(-1);
  const session =
    active ??
    (currentScenario().phase === "Feeding" && last?.scenario === s.scenarioId
      ? last
      : undefined);
  const step =
    active || (session && !s.checkKind && !s.readyCheckId)
      ? 3
      : s.readyCheckId
        ? 2
        : 1;
  const plan =
    s.plans.find((p) => p.id === (active?.planId ?? s.selectedPlanId)) ??
    s.plans[0];
  const favorable = s.analysis.state === "GASTRIC_COMPATIBLE";
  const collecting = s.analysis.state === "COLLECTING";
  const paused = active && (active.status === "PAUSED" || !s.playing);
  const complete = session?.status === "COMPLETED";
  const fault =
    session?.status === "STOPPED" &&
    stopStates.has(session.reason as typeof s.analysis.state);
  function check(replace = false) {
    const kind = replace || !s.tubeInserted ? "Insertion" : "Pre-feed";
    if (s.checkKind) recordFailedCheck();
    setConfirmed(false);
    beginCheck(kind);
  }
  function pauseFeed() {
    pump("pause");
    update({ playing: false });
  }
  function resumeFeed() {
    pump("resume");
    if (activeSession()?.status === "RUNNING") update({ playing: true });
  }
  return (
    <div className="caregiver-flow">
      <ol className="workflow-steps" aria-label="Feeding steps">
        {["Check tube", "Start feeding", "Monitor"].map((label, i) => (
          <li
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
            className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""}
          >
            <span>{step > i + 1 ? <CheckCircle2 size={19} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 1 && (
        <>
          <div className="section-heading">
            <h1>Check the tube.</h1>
          </div>
          <div className="card feeding-plan-card">
            <FeedingReminder plan={plan} s={s} />
          </div>
          <section className="card workflow-card">
            {!s.checkKind ? (
              <>
                <ShieldCheck className="workflow-icon" size={42} />
                <h2>Placement check</h2>
                <p>Collect new sensor readings before feeding.</p>
                <button className="primary full" onClick={() => check()}>
                  Check tube placement <ArrowRight size={20} />
                </button>
                {s.tubeInserted && (
                  <button
                    className="text-button full"
                    onClick={() => check(true)}
                  >
                    Insert or replace tube
                  </button>
                )}
              </>
            ) : (
              <>
                <div
                  className={`status ${favorable ? "good" : collecting ? "caution" : "bad"}`}
                  role="status"
                >
                  {favorable ? (
                    <CheckCircle2 size={32} />
                  ) : collecting ? (
                    <Activity size={32} />
                  ) : (
                    <TriangleAlert size={32} />
                  )}
                  <div>
                    <h2>
                      {collecting
                        ? "Checking placement…"
                        : statusText[s.analysis.state][0]}
                    </h2>
                    <p>
                      {collecting
                        ? "Collecting sensor readings."
                        : favorable
                          ? "Sensor readings alone cannot confirm tube placement. The required placement confirmation must be completed."
                          : statusText[s.analysis.state][1]}
                    </p>
                  </div>
                </div>
                {favorable ? (
                  <div className="fictional-confirm">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      <span>
                        For this demo, the required placement confirmation is
                        complete.
                      </span>
                    </label>
                    <button
                      className="primary full"
                      disabled={!confirmed}
                      onClick={() => {
                        if (confirmCheck()) setConfirmed(false);
                      }}
                    >
                      Continue to feeding <ArrowRight size={20} />
                    </button>
                  </div>
                ) : !collecting ? (
                  <button className="primary full" onClick={() => check()}>
                    Check again
                  </button>
                ) : !s.playing && s.sourceMode === "csv" ? (
                  <button
                    className="primary full"
                    onClick={() => update({ playing: true })}
                  >
                    Resume placement check
                  </button>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
      {step === 2 && (
        <>
          <div className="section-heading">
            <h1>Start the feed.</h1>
          </div>
          <section className="card workflow-card">
            <div className="check-confirmed">
              <CheckCircle2 size={23} /> Placement check complete
            </div>
            <FeedingReminder plan={plan} s={s} />
            <button
              className="primary full start-feeding"
              onClick={() => startFeed()}
            >
              Start feeding <Play size={20} />
            </button>
            <small className="workflow-note">
              Simulation only. No pump is connected.
            </small>
          </section>
        </>
      )}
      {step === 3 && session && (
        <>
          <div className="section-heading">
            <h1>
              {complete
                ? "Feeding complete."
                : fault
                  ? "Feeding stopped."
                  : active
                    ? "Feeding in progress."
                    : "Feeding ended."}
            </h1>
          </div>
          <section className="card workflow-card">
            <div
              className={`status ${fault ? "bad" : complete ? "good" : paused ? "caution" : active && stopStates.has(s.analysis.state) ? "bad" : active && (s.analysis.state === "MONITOR" || s.analysis.state === "COLLECTING") ? "caution" : "good"}`}
              role="status"
            >
              {fault ? (
                <TriangleAlert size={32} />
              ) : paused ? (
                <Pause size={32} />
              ) : active &&
                (s.analysis.state === "MONITOR" ||
                  s.analysis.state === "COLLECTING") ? (
                <Activity size={32} />
              ) : (
                <CheckCircle2 size={32} />
              )}
              <div>
                <h2>
                  {fault
                    ? "Feeding error — stopped"
                    : complete
                      ? "Requested amount delivered"
                      : paused
                        ? "Feeding paused"
                        : active
                          ? s.analysis.state === "MONITOR"
                            ? "Checking an unusual reading"
                            : s.analysis.state === "COLLECTING"
                              ? "Collecting feeding readings"
                              : "No feeding errors detected"
                          : "Feed stopped"}
                </h2>
                <p>
                  {fault
                    ? "Review the warning before starting another feed."
                    : complete
                      ? "Feeding is finished."
                      : paused
                        ? "Select Resume feeding to continue."
                        : active
                          ? "Warnings appear here if a problem is detected."
                          : "Check placement before the next feed."}
                </p>
              </div>
            </div>
            <div className="volume">
              <strong>
                {session.volume.toFixed(1)}
                <small> / {session.target} mL</small>
              </strong>
              <span>
                {session.missing
                  ? "Measured amount · some readings are missing"
                  : "Delivered amount"}
              </span>
            </div>
            <progress
              max={session.target}
              value={session.volume}
              aria-label="Delivered amount"
            />
            {session.missing > 0 && (
              <p className="error">
                Some readings are missing. The full delivered amount is unknown.
              </p>
            )}
            {active ? (
              <div className="button-row">
                <button onClick={paused ? resumeFeed : pauseFeed}>
                  {paused ? <Play size={19} /> : <Pause size={19} />}{" "}
                  {paused ? "Resume feeding" : "Pause feeding"}
                </button>
                <button
                  className="danger-button"
                  onClick={() => {
                    pump("stop");
                    update({ playing: false });
                  }}
                >
                  Stop feeding
                </button>
              </div>
            ) : (
              <button className="primary full" onClick={() => check()}>
                Check tube for next feed <ArrowRight size={20} />
              </button>
            )}
            <small className="workflow-note">
              Simulation only. No pump is connected.
            </small>
          </section>
          {active && (
            <div className="card feeding-plan-card">
              <FeedingReminder
                plan={{ ...plan, volume: active.target, rate: active.rate }}
                s={s}
                feeding
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
