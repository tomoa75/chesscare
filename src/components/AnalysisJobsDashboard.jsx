import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadAnalysisJobsDashboard } from "../domain/analysisDashboardService";
import {
  confirmAnalysisJobCreation,
  createAnalysisJobPreview,
} from "../domain/analysisJobCreationService";
import {
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import { createStockfishClient } from "../domain/stockfishService";
import { executeStoredAnalysisJob } from "../domain/storedAnalysisExecutionService";
import {
  confirmPersonalizedMaterialization,
  createPersonalizedMaterializationPreview,
} from "../domain/personalizedAnalysisMaterializationService";
import "../analysisJobs.css";

const SUMMARY_METRICS = [
  ["total", "Ukupno poslova"],
  ["queued", "Na cekanju"],
  ["running", "U tijeku"],
  ["completed", "Zavrseno"],
  ["failedOrCancelled", "Prekinuto"],
  ["resumable", "Siguran nastavak"],
  ["cachedPositions", "Cache pogodaka"],
];

const DEFAULT_ENGINE = { name: "Stockfish", version: "18" };
const DEFAULT_SETTINGS = {
  depth: 8,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};
const STOCKFISH_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;

function formatDate(value) {
  if (!value) return "Nije zabiljezeno";

  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AnalysisJobsDashboard() {
  const executionRef = useRef({ controller: null, client: null });
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });
  const [selectedGameIds, setSelectedGameIds] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [creationConfirmed, setCreationConfirmed] = useState(false);
  const [creation, setCreation] = useState({
    status: "idle",
    preview: null,
    result: null,
    error: null,
  });
  const [execution, setExecution] = useState({
    status: "idle",
    runId: null,
    completed: 0,
    total: 0,
    cacheHits: 0,
    analyzed: 0,
    error: null,
  });
  const [personalizationSelection, setPersonalizationSelection] = useState({
    runId: "",
    playerId: "",
  });
  const [personalizationConfirmed, setPersonalizationConfirmed] =
    useState(false);
  const [personalization, setPersonalization] = useState({
    status: "idle",
    preview: null,
    result: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const repository = createLocalStorageDomainRepository(
          window.localStorage,
        );
        const data = await loadAnalysisJobsDashboard({ repository });

        if (active) {
          setState({ status: "ready", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error.message,
          });
        }
      }
    };

    void refresh();
    const handleStorage = (event) => {
      if (event.key === DOMAIN_STORAGE_KEY) void refresh();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, [revision]);

  useEffect(
    () => () => {
      executionRef.current.controller?.abort();
      executionRef.current.client?.dispose();
    },
    [],
  );

  const invalidatePreview = () => {
    setCreation({
      status: "idle",
      preview: null,
      result: null,
      error: null,
    });
    setCreationConfirmed(false);
  };

  const toggleGame = (gameId) => {
    setSelectedGameIds((current) =>
      current.includes(gameId)
        ? current.filter((id) => id !== gameId)
        : [...current, gameId],
    );
    invalidatePreview();
  };

  const updateSetting = (name, value) => {
    setSettings((current) => ({
      ...current,
      [name]: Number(value),
    }));
    invalidatePreview();
  };

  const prepareCreation = async () => {
    setCreation({
      status: "preparing",
      preview: null,
      result: null,
      error: null,
    });
    setCreationConfirmed(false);

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const preview = await createAnalysisJobPreview({
        repository,
        gameIds: selectedGameIds,
        engine: DEFAULT_ENGINE,
        settings,
      });

      setCreation({
        status: "preview",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setCreation({
        status: "error",
        preview: null,
        result: null,
        error: error.message,
      });
    }
  };

  const confirmCreation = async () => {
    if (!creation.preview || !creationConfirmed) return;

    setCreation((current) => ({
      ...current,
      status: "creating",
      error: null,
    }));

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const result = await confirmAnalysisJobCreation({
        repository,
        gameIds: selectedGameIds,
        engine: DEFAULT_ENGINE,
        settings,
        previewToken: creation.preview.token,
      });

      setCreation({
        status: "success",
        preview: creation.preview,
        result,
        error: null,
      });
      setCreationConfirmed(false);
      setRevision((current) => current + 1);
    } catch (error) {
      setCreation((current) => ({
        ...current,
        status: "error",
        error: error.message,
      }));
    }
  };

  const startExecution = async (job) => {
    if (execution.status === "running" || execution.status === "cancelling") {
      return;
    }

    const controller = new AbortController();
    const client = createStockfishClient({
      workerUrl: STOCKFISH_URL,
      timeoutMs: 60000,
      workerFactory: (workerUrl) => new Worker(workerUrl),
    });
    executionRef.current = { controller, client };
    setExecution({
      status: "running",
      runId: job.id,
      completed: job.targets.cached,
      total: job.targets.total,
      cacheHits: job.targets.cached,
      analyzed: 0,
      error: null,
    });

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const result = await executeStoredAnalysisJob({
        repository,
        stockfishClient: client,
        runId: job.id,
        signal: controller.signal,
        onProgress: (update) => {
          setExecution((current) => ({
            ...current,
            status: "running",
            completed: update.completed,
            total: update.total,
            cacheHits: update.cacheHits,
            analyzed: update.analyzed,
          }));
        },
      });

      setExecution({
        status: "success",
        runId: job.id,
        completed: result.run.progress.completed,
        total: result.run.progress.total,
        cacheHits: result.cacheHits,
        analyzed: result.analyzed,
        error: null,
      });
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error.code === "analysis-cancelled";
      setExecution((current) => ({
        ...current,
        status: cancelled ? "cancelled" : "error",
        error: cancelled ? null : error.message,
      }));
    } finally {
      client.dispose();
      executionRef.current = { controller: null, client: null };
      setRevision((current) => current + 1);
    }
  };

  const cancelExecution = () => {
    if (execution.status !== "running") return;
    setExecution((current) => ({ ...current, status: "cancelling" }));
    executionRef.current.controller?.abort();
  };

  const updatePersonalizationSelection = (name, value) => {
    setPersonalizationSelection((current) => ({
      ...current,
      [name]: value,
    }));
    setPersonalization({
      status: "idle",
      preview: null,
      result: null,
      error: null,
    });
    setPersonalizationConfirmed(false);
  };

  const preparePersonalization = async () => {
    setPersonalization({
      status: "preparing",
      preview: null,
      result: null,
      error: null,
    });
    setPersonalizationConfirmed(false);

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const preview = await createPersonalizedMaterializationPreview({
        repository,
        runId: personalizationSelection.runId,
        playerId: personalizationSelection.playerId,
      });

      setPersonalization({
        status: "preview",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setPersonalization({
        status: "error",
        preview: null,
        result: null,
        error: error.message,
      });
    }
  };

  const confirmPersonalization = async () => {
    if (!personalization.preview || !personalizationConfirmed) return;

    setPersonalization((current) => ({
      ...current,
      status: "saving",
      error: null,
    }));

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const result = await confirmPersonalizedMaterialization({
        repository,
        runId: personalizationSelection.runId,
        playerId: personalizationSelection.playerId,
        previewToken: personalization.preview.token,
      });

      setPersonalization({
        status: "success",
        preview: personalization.preview,
        result,
        error: null,
      });
      setPersonalizationConfirmed(false);
      setRevision((current) => current + 1);
    } catch (error) {
      setPersonalization((current) => ({
        ...current,
        status: "error",
        error: error.message,
      }));
    }
  };

  if (state.status === "loading" && !state.data) {
    return (
      <main className="jobs-page">
        <div className="jobs-state">Ucitavam analiticke poslove...</div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="jobs-page">
        <div className="jobs-state jobs-error">
          <h1>Analiticki poslovi nisu dostupni</h1>
          <p>{state.error}</p>
          <p>Domenski podaci nisu promijenjeni.</p>
        </div>
      </main>
    );
  }

  const { data } = state;

  return (
    <main className="jobs-page">
      <header className="jobs-header">
        <div>
          <span className="jobs-eyebrow">Trajni poslovi</span>
          <h1>Status analiza</h1>
          <p>
            Read-only pregled napretka, kompatibilnog cachea i uvjeta za
            nastavak. Ova stranica ne pokrece Stockfish i ne mijenja zapise.
          </p>
        </div>
        {state.status === "loading" && <span>Osvjezavam...</span>}
      </header>

      <section className="jobs-summary">
        {SUMMARY_METRICS.map(([key, label]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>{data.summary[key]}</strong>
          </article>
        ))}
      </section>

      <section className="job-creation-panel">
        <div className="job-creation-heading">
          <div>
            <h2>Novi analiticki posao</h2>
            <p>
              Odaberi domenske partije i prvo pripremi preview. Potvrda stvara
              samo queued zapis; Stockfish se ne pokrece.
            </p>
          </div>
          <div className="job-engine-label">
            {DEFAULT_ENGINE.name} {DEFAULT_ENGINE.version}
          </div>
        </div>

        {data.availableGames.length === 0 ? (
          <p className="job-creation-empty">
            Nema domenskih partija. Prvo ih migriraj kroz Dijagnostiku.
          </p>
        ) : (
          <>
            <fieldset className="job-game-selection">
              <legend>Partije</legend>
              {data.availableGames.map((game) => (
                <label key={game.id}>
                  <input
                    type="checkbox"
                    checked={selectedGameIds.includes(game.id)}
                    onChange={() => toggleGame(game.id)}
                    disabled={creation.status === "creating"}
                  />
                  <span>
                    <strong>{game.title}</strong>
                    <small>
                      {game.white} - {game.black}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="job-settings">
              <label>
                <span>Dubina</span>
                <input
                  type="number"
                  min="4"
                  max="20"
                  value={settings.depth}
                  onChange={(event) =>
                    updateSetting("depth", event.target.value)
                  }
                  disabled={creation.status === "creating"}
                />
              </label>
              <label>
                <span>MultiPV</span>
                <select
                  value={settings.multiPv}
                  onChange={(event) =>
                    updateSetting("multiPv", event.target.value)
                  }
                  disabled={creation.status === "creating"}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <button
                type="button"
                className="job-preview-button"
                onClick={prepareCreation}
                disabled={
                  selectedGameIds.length === 0 ||
                  creation.status === "preparing" ||
                  creation.status === "creating"
                }
              >
                {creation.status === "preparing"
                  ? "Pripremam..."
                  : "Pripremi preview"}
              </button>
            </div>
          </>
        )}

        {creation.preview && (
          <div className="job-creation-preview">
            <div>
              <span>Odabrane partije</span>
              <strong>{creation.preview.games.length}</strong>
            </div>
            <div>
              <span>Jedinstvene pozicije</span>
              <strong>{creation.preview.targets.total}</strong>
            </div>
            <div>
              <span>Cache pogodaka</span>
              <strong>{creation.preview.targets.cached}</strong>
            </div>
            <div>
              <span>Za analizu</span>
              <strong>{creation.preview.targets.remaining}</strong>
            </div>
          </div>
        )}

        {creation.preview?.warnings.length > 0 && (
          <ul className="job-warnings">
            {creation.preview.warnings.map((item, index) => (
              <li key={`${item.code}-${item.gameId}-${index}`}>
                <strong>{item.code}</strong>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        )}

        {creation.preview?.canCreate && (
          <div className="job-creation-confirm">
            <label>
              <input
                type="checkbox"
                checked={creationConfirmed}
                onChange={(event) =>
                  setCreationConfirmed(event.target.checked)
                }
                disabled={creation.status === "creating"}
              />
              <span>
                Potvrdujem stvaranje queued posla s prikazanim postavkama.
              </span>
            </label>
            <button
              type="button"
              onClick={confirmCreation}
              disabled={
                !creationConfirmed || creation.status === "creating"
              }
            >
              {creation.status === "creating"
                ? "Stvaram..."
                : "Stvori queued posao"}
            </button>
          </div>
        )}

        {creation.status === "error" && (
          <p className="job-creation-message job-creation-error">
            {creation.error}
          </p>
        )}

        {creation.status === "success" && (
          <p className="job-creation-message job-creation-success">
            Posao je{" "}
            {creation.result.status === "already-created"
              ? "vec postojao"
              : "stvoren"}
            : <code>{creation.result.run.id}</code>. Engine nije pokrenut.
          </p>
        )}
      </section>

      {execution.status !== "idle" && (
        <section
          className={`job-execution job-execution-${execution.status}`}
        >
          <div>
            <strong>
              {execution.status === "running" && "Stockfish analizira"}
              {execution.status === "cancelling" && "Zaustavljam Stockfish"}
              {execution.status === "success" && "Analiza je zavrsena"}
              {execution.status === "cancelled" && "Analiza je otkazana"}
              {execution.status === "error" && "Analiza nije uspjela"}
            </strong>
            <span>{execution.runId}</span>
          </div>
          <div className="job-execution-progress">
            <span>
              {execution.completed}/{execution.total} pozicija
            </span>
            <span>
              cache {execution.cacheHits}, novo {execution.analyzed}
            </span>
          </div>
          {(execution.status === "running" ||
            execution.status === "cancelling") && (
            <div className="job-progress-track">
              <div
                className="job-progress-fill"
                style={{
                  width:
                    execution.total > 0
                      ? `${Math.round(
                          (execution.completed / execution.total) * 100,
                        )}%`
                      : "0%",
                }}
              />
            </div>
          )}
          {execution.status === "running" && (
            <button type="button" onClick={cancelExecution}>
              Otkaži analizu
            </button>
          )}
          {execution.error && <p>{execution.error}</p>}
        </section>
      )}

      <section className="personalization-panel">
        <div className="job-creation-heading">
          <div>
            <h2>Personalizirani rezultati igraca</h2>
            <p>
              Odaberi dovrseni posao i postojeci profil. Preview koristi samo
              playerId ili vec potvrdene aliase i ne spaja imena automatski.
            </p>
          </div>
        </div>

        {data.availablePlayers.length === 0 ? (
          <p className="job-creation-empty">
            Nema profila igraca u domenskom repositoryju.
          </p>
        ) : data.jobs.every((job) => job.status !== "completed") ? (
          <p className="job-creation-empty">
            Prvo dovrsi barem jedan Stockfish posao.
          </p>
        ) : (
          <div className="personalization-controls">
            <label>
              <span>Dovrseni posao</span>
              <select
                value={personalizationSelection.runId}
                onChange={(event) =>
                  updatePersonalizationSelection(
                    "runId",
                    event.target.value,
                  )
                }
                disabled={personalization.status === "saving"}
              >
                <option value="">Odaberi posao</option>
                {data.jobs
                  .filter((job) => job.status === "completed")
                  .map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.games.map((game) => game.title).join(", ")} - dubina{" "}
                      {job.settings.depth}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Profil igraca</span>
              <select
                value={personalizationSelection.playerId}
                onChange={(event) =>
                  updatePersonalizationSelection(
                    "playerId",
                    event.target.value,
                  )
                }
                disabled={personalization.status === "saving"}
              >
                <option value="">Odaberi profil</option>
                {data.availablePlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="job-preview-button"
              onClick={preparePersonalization}
              disabled={
                !personalizationSelection.runId ||
                !personalizationSelection.playerId ||
                personalization.status === "preparing" ||
                personalization.status === "saving"
              }
            >
              {personalization.status === "preparing"
                ? "Pripremam..."
                : "Pripremi preview"}
            </button>
          </div>
        )}

        {personalization.preview && (
          <>
            <div className="job-creation-preview">
              <div>
                <span>Partije u poslu</span>
                <strong>
                  {personalization.preview.summary.gamesInRun}
                </strong>
              </div>
              <div>
                <span>Prepoznate partije</span>
                <strong>
                  {personalization.preview.summary.gamesMatched}
                </strong>
              </div>
              <div>
                <span>Potezi igraca</span>
                <strong>
                  {personalization.preview.summary.playerMoveContexts}
                </strong>
              </div>
              <div>
                <span>Novi rezultati</span>
                <strong>{personalization.preview.summary.toAdd}</strong>
              </div>
            </div>

            {personalization.preview.gameMatches.length > 0 && (
              <ul className="personalization-matches">
                {personalization.preview.gameMatches.map((match) => (
                  <li key={match.gameId}>
                    <strong>{match.gameId}</strong>
                    <span>
                      {match.color}, {match.method}, {match.moves} poteza
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {personalization.preview.warnings.length > 0 && (
              <ul className="job-warnings">
                {personalization.preview.warnings.map((item, index) => (
                  <li key={`${item.code}-${item.gameId}-${index}`}>
                    <strong>{item.code}</strong>
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {personalization.preview.conflicts.length > 0 && (
              <p className="job-creation-message job-creation-error">
                Pronadjeno je {personalization.preview.conflicts.length}{" "}
                konflikata. Postojeci rezultati nece biti prepisani.
              </p>
            )}
          </>
        )}

        {personalization.preview?.canMaterialize &&
          personalization.preview.summary.toAdd > 0 && (
            <div className="job-creation-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={personalizationConfirmed}
                  onChange={(event) =>
                    setPersonalizationConfirmed(event.target.checked)
                  }
                  disabled={personalization.status === "saving"}
                />
                <span>
                  Potvrdujem spremanje prikazanih MoveAnalysis zapisa.
                </span>
              </label>
              <button
                type="button"
                onClick={confirmPersonalization}
                disabled={
                  !personalizationConfirmed ||
                  personalization.status === "saving"
                }
              >
                {personalization.status === "saving"
                  ? "Spremam..."
                  : "Spremi personalizirane rezultate"}
              </button>
            </div>
          )}

        {personalization.preview?.canMaterialize &&
          personalization.preview.summary.toAdd === 0 && (
            <p className="job-creation-message job-creation-success">
              Svi generirani rezultati vec postoje; nema novih zapisa.
            </p>
          )}

        {personalization.status === "error" && (
          <p className="job-creation-message job-creation-error">
            {personalization.error}
          </p>
        )}

        {personalization.status === "success" && (
          <p className="job-creation-message job-creation-success">
            Spremljeno novih rezultata: {personalization.result.added}.
          </p>
        )}
      </section>

      {data.jobs.length === 0 ? (
        <section className="jobs-state">
          <h2>Nema domenskih analitickih poslova</h2>
          <p>
            Migrirane partije mozes provjeriti u Biblioteci. Stvaranje prvog
            posla bit ce dodano kao zaseban, potvrdeni korak.
          </p>
          <Link className="jobs-link" to="/library">
            Otvori Biblioteku
          </Link>
        </section>
      ) : (
        <section className="jobs-list">
          {data.jobs.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-heading">
                <div>
                  <span className={`job-status job-status-${job.status}`}>
                    {job.statusLabel}
                  </span>
                  <h2>{job.games.map((game) => game.title).join(", ")}</h2>
                  <small>{job.id}</small>
                </div>
                <div
                  className={
                    job.resume.allowed
                      ? "job-resume job-resume-ready"
                      : "job-resume"
                  }
                >
                  {job.resume.label}
                </div>
              </div>

              <div className="job-progress-heading">
                <span>
                  Spremljeni napredak: {job.progress.completed}/
                  {job.progress.total}
                </span>
                <strong>{job.progress.percent}%</strong>
              </div>
              <div className="job-progress-track">
                <div
                  className="job-progress-fill"
                  style={{ width: `${job.progress.percent}%` }}
                />
              </div>

              <dl className="job-metadata">
                <div>
                  <dt>Engine</dt>
                  <dd>
                    {job.engine.name} {job.engine.version}
                  </dd>
                </div>
                <div>
                  <dt>Postavke</dt>
                  <dd>
                    dubina {job.settings.depth}, MultiPV{" "}
                    {job.settings.multiPv}
                  </dd>
                </div>
                <div>
                  <dt>Izvedene pozicije</dt>
                  <dd>{job.targets.total}</dd>
                </div>
                <div>
                  <dt>Cache / preostalo</dt>
                  <dd>
                    {job.targets.cached} / {job.targets.remaining}
                  </dd>
                </div>
                <div>
                  <dt>Stvoreno</dt>
                  <dd>{formatDate(job.createdAt)}</dd>
                </div>
                <div>
                  <dt>Zavrseno</dt>
                  <dd>{formatDate(job.completedAt)}</dd>
                </div>
              </dl>

              {job.error && (
                <p className="job-error-message">
                  Posljednja greska: {job.error}
                </p>
              )}

              {job.warnings.length > 0 && (
                <ul className="job-warnings">
                  {job.warnings.map((item, index) => (
                    <li key={`${item.code}-${item.gameId}-${index}`}>
                      <strong>{item.code}</strong>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {job.resume.allowed && (
                <button
                  type="button"
                  className="job-run-button"
                  onClick={() => startExecution(job)}
                  disabled={
                    execution.status === "running" ||
                    execution.status === "cancelling"
                  }
                >
                  {job.resume.code === "ready-to-start"
                    ? "Pokreni Stockfish"
                    : "Nastavi iz cachea"}
                </button>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
