import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadPersonalizedDashboard } from "../domain/personalizedDashboardService";
import {
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../personalizedDashboard.css";

const GROUP_LABELS = {
  white: "Bijeli",
  black: "Crni",
  opening: "Otvaranje",
  middlegame: "Sredisnjica",
  endgame: "Zavrsnica",
  "1-0": "1-0",
  "0-1": "0-1",
  "1/2-1/2": "Remi",
  "*": "Bez rezultata",
  unknown: "Nepoznat datum",
};

const CLASSIFICATION_LABELS = {
  good: "Dobri",
  inaccuracy: "Nepreciznosti",
  mistake: "Pogreske",
  blunder: "Velike pogreske",
};

const CONFIDENCE_LABELS = {
  low: "mali uzorak",
  medium: "srednji uzorak",
  high: "veliki uzorak",
};

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("hr-HR", {
    maximumFractionDigits,
  }).format(value);
}

function MetricGroup({ title, groups }) {
  return (
    <section className="player-report-section">
      <h2>{title}</h2>
      <div className="player-group-grid">
        {groups.map((group) => (
          <article className="player-group-card" key={group.key}>
            <div>
              <h3>{GROUP_LABELS[group.key] || group.key}</h3>
              <span>{group.sampleSize} analiziranih poteza</span>
            </div>
            <dl>
              <div>
                <dt>Prosjecni gubitak</dt>
                <dd>{formatNumber(group.averageLoss)} cp</dd>
              </div>
              <div>
                <dt>Heuristicka preciznost</dt>
                <dd>{formatNumber(group.accuracy)}%</dd>
              </div>
              <div>
                <dt>Pouzdanost</dt>
                <dd>{CONFIDENCE_LABELS[group.confidence]}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function PersonalizedDashboard() {
  const [playerId, setPlayerId] = useState("");
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (period.from && period.to && period.from > period.to) return;

      setState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const repository = createLocalStorageDomainRepository(
          window.localStorage,
        );
        const data = await loadPersonalizedDashboard({
          repository,
          playerId,
          period,
        });
        if (active) setState({ status: "ready", data, error: null });
      } catch (error) {
        if (active) {
          setState({ status: "error", data: null, error: error.message });
        }
      }
    };

    void load();
    const handleStorage = (event) => {
      if (event.key === DOMAIN_STORAGE_KEY) void load();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, [period, playerId]);

  if (state.status === "loading" && !state.data) {
    return (
      <main className="player-dashboard">
        <section className="player-dashboard-state">
          Ucitavam personalizirani izvjestaj...
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="player-dashboard">
        <section className="player-dashboard-state player-dashboard-error">
          <h1>Izvjestaj nije dostupan</h1>
          <p>{state.error}</p>
          <p>Domenski podaci nisu promijenjeni.</p>
        </section>
      </main>
    );
  }

  const { data } = state;
  const report = data.report;
  const invalidPeriod =
    period.from && period.to && period.from > period.to;

  return (
    <main className="player-dashboard">
      <header className="player-dashboard-header">
        <div>
          <span className="player-dashboard-eyebrow">Read-only analiza</span>
          <h1>Profil igraca</h1>
          <p>
            Agregirani prikaz spremljenih MoveAnalysis rezultata. Ovaj prikaz
            ne pokrece Stockfish, ne mijenja aliase i ne zapisuje podatke.
          </p>
        </div>
        <label className="player-selector">
          <span>Profil</span>
          <select
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            <option value="">Odaberi igraca</option>
            {data.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.displayName} ({player.analyzedMoves} poteza)
              </option>
            ))}
          </select>
        </label>
      </header>

      {playerId && (
        <section className="player-period-controls">
          <div>
            <strong>Vremensko razdoblje</strong>
            <span>
              Koristi samo potpune datume partija iz PGN headera.
            </span>
          </div>
          <label>
            <span>Od</span>
            <input
              type="date"
              value={period.from}
              max={period.to || undefined}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Do</span>
            <input
              type="date"
              value={period.to}
              min={period.from || undefined}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
            />
          </label>
          <button
            type="button"
            onClick={() => setPeriod({ from: "", to: "" })}
            disabled={!period.from && !period.to}
          >
            Ponisti
          </button>
        </section>
      )}

      {invalidPeriod && (
        <p className="player-period-error">
          Pocetak razdoblja ne moze biti nakon kraja.
        </p>
      )}

      {data.summary.totalPlayers === 0 ? (
        <section className="player-dashboard-state">
          <h2>Nema profila igraca</h2>
          <p>Profile prvo dodaj kontroliranom migracijom.</p>
          <Link to="/development">Otvori Dijagnostiku</Link>
        </section>
      ) : !report ? (
        <section className="player-dashboard-state">
          <h2>Odaberi profil</h2>
          <p>
            {data.summary.analyzedPlayers} od {data.summary.totalPlayers}{" "}
            profila trenutno ima spremljene personalizirane rezultate.
          </p>
        </section>
      ) : invalidPeriod ? null : report.overall.sampleSize === 0 ? (
        <section className="player-dashboard-state">
          <h2>
            {report.period.active
              ? "Nema poteza u odabranom razdoblju"
              : `Nema analiziranih poteza za ${report.player.displayName}`}
          </h2>
          {report.period.active ? (
            <>
              <p>
                Nedatirani potezi: {report.period.excludedUndatedMoves}.
                Izvan raspona: {report.period.excludedOutsideRangeMoves}.
              </p>
              <button
                type="button"
                className="player-period-reset"
                onClick={() => setPeriod({ from: "", to: "" })}
              >
                Prikazi cijelo razdoblje
              </button>
            </>
          ) : (
            <>
              <p>
                Dovrsi analiticki posao i materijaliziraj rezultate na
                stranici Poslovi.
              </p>
              <Link to="/analysis-jobs">Otvori Poslove</Link>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="player-profile-summary">
            <div>
              <span>Igrac</span>
              <strong>{report.player.displayName}</strong>
              <small>
                {data.selectedPlayer.aliases.length} potvrdenih imena
              </small>
            </div>
            <div>
              <span>Partije</span>
              <strong>{report.gamesAnalyzed}</strong>
              <small>s analiziranim potezima</small>
            </div>
            <div>
              <span>Potezi</span>
              <strong>{report.overall.sampleSize}</strong>
              <small>{CONFIDENCE_LABELS[report.overall.confidence]}</small>
            </div>
            <div>
              <span>Prosjecni gubitak</span>
              <strong>{formatNumber(report.overall.averageLoss)} cp</strong>
              <small>sirova izvedena metrika</small>
            </div>
            <div>
              <span>Preciznost</span>
              <strong>{formatNumber(report.overall.accuracy)}%</strong>
              <small>heuristicka procjena</small>
            </div>
          </section>

          {data.warnings.length > 0 && (
            <ul className="player-dashboard-warnings">
              {data.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.referenceId}`}>
                  <strong>{warning.code}</strong>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          )}

          <section className="player-report-section">
            <h2>Klasifikacija poteza</h2>
            <div className="classification-grid">
              {Object.entries(report.overall.classifications).map(
                ([classification, count]) => (
                  <article key={classification}>
                    <strong>{count}</strong>
                    <span>{CLASSIFICATION_LABELS[classification]}</span>
                  </article>
                ),
              )}
            </div>
          </section>

          {report.period.active && (
            <p className="player-period-note">
              Aktivni raspon: {report.period.from || "pocetak"} –{" "}
              {report.period.to || "danas"}. Iskljuceno nedatiranih poteza:{" "}
              {report.period.excludedUndatedMoves}; izvan raspona:{" "}
              {report.period.excludedOutsideRangeMoves}.
            </p>
          )}

          {report.weakestPhase && (
            <aside className="weakest-phase">
              <span>Najslabija faza prema prosjecnom gubitku</span>
              <strong>
                {GROUP_LABELS[report.weakestPhase.phase]} ·{" "}
                {formatNumber(report.weakestPhase.averageLoss)} cp
              </strong>
              <small>
                Zakljucak se temelji na {report.weakestPhase.sampleSize} poteza.
              </small>
            </aside>
          )}

          <MetricGroup title="Prema boji" groups={report.byColor} />
          <MetricGroup title="Prema fazi partije" groups={report.byPhase} />
          <MetricGroup title="Prema rezultatu partije" groups={report.byResult} />
          <MetricGroup title="Prema otvaranju" groups={report.byOpening} />
          <MetricGroup title="Prema godini" groups={report.byPeriod} />

          <section className="player-report-section">
            <h2>Izvori analize</h2>
            <p className="player-report-note">
              Metrike ispod nastale su iz ovih spremljenih poslova i postavki
              enginea.
            </p>
            <div className="analysis-source-list">
              {data.sources.map((source) => (
                <article key={source.runId}>
                  <div>
                    <strong>
                      {source.found
                        ? `${source.engine.name} ${source.engine.version}`
                        : "Izvorni posao nedostaje"}
                    </strong>
                    <code>{source.runId}</code>
                  </div>
                  <span>
                    {source.moveCount} poteza · {source.gameCount} partija
                    {source.settings
                      ? ` · dubina ${source.settings.depth} · MultiPV ${source.settings.multiPv}`
                      : ""}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
