import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadTrainingProgress } from "../domain/trainingProgressService";
import {
  createBrowserDomainRepository,
  DOMAIN_STORAGE_CHANGED_EVENT,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../trainingProgressDashboard.css";

const OUTCOME_LABELS = {
  again: "Ponovi",
  hard: "Tesko",
  good: "Dobro",
  easy: "Lako",
};

const STATUS_LABELS = {
  new: "Novi",
  learning: "Ucenje",
  review: "Ponavljanje",
  mastered: "Savladano",
  suspended: "Pauzirano",
};

const PHASE_LABELS = {
  opening: "Otvaranje",
  middlegame: "Sredisnjica",
  endgame: "Zavrsnica",
};

const CONFIDENCE_LABELS = {
  low: "mali uzorak",
  medium: "srednji uzorak",
  high: "veliki uzorak",
};

function formatPercent(value) {
  return new Intl.NumberFormat("hr-HR", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ProgressGroups({ title, groups, phaseLabels = false }) {
  return (
    <section className="training-progress-section">
      <h2>{title}</h2>
      {groups.length === 0 ? (
        <p className="training-progress-note">Nema podataka za ovu grupu.</p>
      ) : (
        <div className="training-progress-groups">
          {groups.map((group) => (
            <article key={group.key}>
              <div className="training-progress-group-heading">
                <div>
                  <h3>
                    {phaseLabels
                      ? PHASE_LABELS[group.key] || group.key
                      : group.key}
                  </h3>
                  <span>
                    {group.attemptCount} pokusaja ·{" "}
                    {CONFIDENCE_LABELS[group.confidence]}
                  </span>
                </div>
                <strong>{formatPercent(group.successRate)}%</strong>
              </div>
              <div className="training-progress-track">
                <div style={{ width: `${group.successRate}%` }} />
              </div>
              <dl>
                <div>
                  <dt>Zadaci</dt>
                  <dd>{group.taskCount}</dd>
                </div>
                <div>
                  <dt>Dospjelo</dt>
                  <dd>{group.dueTaskCount}</dd>
                </div>
                <div>
                  <dt>Prosjecni prioritet</dt>
                  <dd>{formatPercent(group.averagePriority)}</dd>
                </div>
                <div>
                  <dt>Ponovi</dt>
                  <dd>{group.outcomes.again}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function TrainingProgressDashboard() {
  const [playerId, setPlayerId] = useState("");
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const repository = createBrowserDomainRepository(window);
        const data = await loadTrainingProgress({ repository, playerId });
        if (active) setState({ status: "ready", data, error: null });
      } catch (error) {
        if (active) {
          setState({ status: "error", data: null, error: error.message });
        }
      }
    };

    void load();
    const handleStorage = (event) => {
      if (
        event.key === DOMAIN_STORAGE_KEY ||
        event.detail?.key === DOMAIN_STORAGE_KEY
      ) void load();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    };
  }, [playerId]);

  if (state.status === "loading") {
    return (
      <main className="training-progress-page">
        <section className="training-progress-state">
          Ucitavam povijest treninga...
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="training-progress-page">
        <section className="training-progress-state training-progress-error">
          <h1>Napredak nije dostupan</h1>
          <p>{state.error}</p>
          <p>Podaci nisu promijenjeni.</p>
        </section>
      </main>
    );
  }

  const { data } = state;
  const report = data.report;

  return (
    <main className="training-progress-page">
      <header className="training-progress-header">
        <div>
          <span>Read-only izvjestaj</span>
          <h1>Napredak treninga</h1>
          <p>
            Pregled povijesti pokusaja, rasporeda i ponavljajucih slabosti.
            Izvjestaj ne mijenja zadatke ni rezultate.
          </p>
        </div>
        <label>
          <span>Profil igraca</span>
          <select
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            <option value="">Odaberi profil</option>
            {data.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.displayName} · {player.attemptCount} pokusaja
              </option>
            ))}
          </select>
        </label>
      </header>

      {!report ? (
        <section className="training-progress-state">
          <h2>Odaberi profil</h2>
          <p>Prikazat ce se samo njegova povijest i zadaci.</p>
        </section>
      ) : report.overall.taskCount === 0 ? (
        <section className="training-progress-state">
          <h2>Nema trening podataka</h2>
          <p>Prvo generiraj personalizirane zadatke.</p>
          <Link to="/training-plan">Otvori plan treninga</Link>
        </section>
      ) : (
        <>
          <section className="training-progress-summary">
            <article>
              <span>Zadaci</span>
              <strong>{report.overall.taskCount}</strong>
              <small>{report.overall.dueTaskCount} dospjelo</small>
            </article>
            <article>
              <span>Pokusaji</span>
              <strong>{report.overall.attemptCount}</strong>
              <small>{report.overall.correctAttempts} uspjesnih</small>
            </article>
            <article>
              <span>Uspjesnost</span>
              <strong>{formatPercent(report.overall.successRate)}%</strong>
              <small>
                {CONFIDENCE_LABELS[report.overall.confidence]}
              </small>
            </article>
            <article>
              <span>Prosjecni prioritet</span>
              <strong>
                {formatPercent(report.overall.averagePriority)}
              </strong>
              <small>0–100</small>
            </article>
          </section>

          {data.warnings.length > 0 && (
            <ul className="training-progress-warnings">
              {data.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.taskId}`}>
                  <strong>{warning.code}</strong> {warning.message}
                </li>
              ))}
            </ul>
          )}

          <section className="training-progress-section">
            <h2>Ishodi i raspored</h2>
            <div className="training-progress-split">
              <div className="training-outcome-summary">
                {Object.entries(report.overall.outcomes).map(
                  ([outcome, count]) => (
                    <article key={outcome}>
                      <strong>{count}</strong>
                      <span>{OUTCOME_LABELS[outcome]}</span>
                    </article>
                  ),
                )}
              </div>
              <div className="training-schedule-summary">
                {Object.entries(report.schedule).map(([status, count]) => (
                  <div key={status}>
                    <span>{STATUS_LABELS[status]}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <ProgressGroups
            title="Prema slabosti"
            groups={report.byWeakness}
          />
          <ProgressGroups
            title="Prema fazi partije"
            groups={report.byPhase}
            phaseLabels
          />

          <section className="training-progress-section">
            <h2>Posljednji pokusaji</h2>
            {report.recentAttempts.length === 0 ? (
              <p className="training-progress-note">
                Jos nema spremljenih pokusaja.
              </p>
            ) : (
              <div className="training-recent-attempts">
                {report.recentAttempts.map((attempt) => (
                  <article key={attempt.id}>
                    <div>
                      <strong>
                        {attempt.gameTitle || "Izvorni zadatak nedostaje"}
                      </strong>
                      <span>{attempt.weaknessKey || attempt.taskId}</span>
                    </div>
                    <div>
                      <strong>{OUTCOME_LABELS[attempt.outcome]}</strong>
                      <span>
                        {attempt.attemptedMove?.san || "Bez poteza"} ·{" "}
                        {formatDate(attempt.attemptedAt)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
