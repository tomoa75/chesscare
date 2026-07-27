import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  confirmTrainingMaterialization,
  createTrainingMaterializationPreview,
  loadTrainingMaterializationDashboard,
} from "../domain/trainingMaterializationService";
import {
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../trainingPlanDashboard.css";

const CLASSIFICATION_LABELS = {
  inaccuracy: "nepreciznost",
  mistake: "pogreska",
  blunder: "velika pogreska",
};

const PHASE_LABELS = {
  opening: "otvaranje",
  middlegame: "sredisnjica",
  endgame: "zavrsnica",
};

export default function TrainingPlanDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [playerId, setPlayerId] = useState("");
  const [minimumLoss, setMinimumLoss] = useState(50);
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState({
    status: "idle",
    preview: null,
    result: null,
    error: null,
  });

  const loadDashboard = useCallback(async () => {
    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const data = await loadTrainingMaterializationDashboard({
        repository,
      });
      setDashboard(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const handleStorage = (event) => {
      if (event.key === DOMAIN_STORAGE_KEY) void loadDashboard();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [loadDashboard]);

  const resetPreview = () => {
    setConfirmed(false);
    setOperation({
      status: "idle",
      preview: null,
      result: null,
      error: null,
    });
  };

  const preparePreview = async () => {
    setConfirmed(false);
    setOperation({
      status: "preparing",
      preview: null,
      result: null,
      error: null,
    });

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const preview = await createTrainingMaterializationPreview({
        repository,
        playerId,
        minimumLoss: Number(minimumLoss),
      });
      setOperation({
        status: "ready",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setOperation({
        status: "error",
        preview: null,
        result: null,
        error: error.message,
      });
    }
  };

  const saveTasks = async () => {
    const preview = operation.preview;
    if (!preview || !confirmed) return;

    setOperation((current) => ({
      ...current,
      status: "saving",
      error: null,
    }));

    try {
      const repository = createLocalStorageDomainRepository(
        window.localStorage,
      );
      const result = await confirmTrainingMaterialization({
        repository,
        playerId: preview.player.id,
        minimumLoss: preview.minimumLoss,
        referenceTime: preview.referenceTime,
        previewToken: preview.token,
      });
      setConfirmed(false);
      setOperation((current) => ({
        ...current,
        status: "success",
        result,
        error: null,
      }));
      await loadDashboard();
    } catch (error) {
      setOperation((current) => ({
        ...current,
        status: "error",
        result: null,
        error: error.message,
      }));
    }
  };

  if (loadError) {
    return (
      <main className="training-plan-page">
        <section className="training-plan-state training-plan-error">
          <h1>Plan treninga nije dostupan</h1>
          <p>{loadError}</p>
          <p>Domenski podaci nisu promijenjeni.</p>
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="training-plan-page">
        <section className="training-plan-state">
          Ucitavam podatke za trening...
        </section>
      </main>
    );
  }

  const preview = operation.preview;

  return (
    <main className="training-plan-page">
      <header className="training-plan-header">
        <div>
          <span>Kontrolirana materijalizacija</span>
          <h1>Personalizirani trening</h1>
          <p>
            Pretvori spremljene pogreske u domenske trening zadatke. Preview
            ne mijenja podatke, a spremanje zahtijeva izricitu potvrdu.
          </p>
        </div>
        <dl>
          <div>
            <dt>Spremljeno</dt>
            <dd>{dashboard.summary.totalTasks}</dd>
          </div>
          <div>
            <dt>Dospjelo</dt>
            <dd>{dashboard.summary.dueTasks}</dd>
          </div>
          <div>
            <dt>Pokusaji</dt>
            <dd>{dashboard.summary.totalAttempts}</dd>
          </div>
        </dl>
      </header>

      {dashboard.players.length === 0 ? (
        <section className="training-plan-state">
          <h2>Nema profila igraca</h2>
          <Link to="/development">Otvori Dijagnostiku</Link>
        </section>
      ) : (
        <section className="training-plan-control">
          <label>
            <span>Profil igraca</span>
            <select
              value={playerId}
              onChange={(event) => {
                setPlayerId(event.target.value);
                resetPreview();
              }}
              disabled={operation.status === "saving"}
            >
              <option value="">Odaberi profil</option>
              {dashboard.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.displayName} · {player.analyzedMoves} analiza ·{" "}
                  {player.trainingTasks} zadataka
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Minimalni gubitak (cp)</span>
            <input
              type="number"
              min="0"
              step="10"
              value={minimumLoss}
              onChange={(event) => {
                setMinimumLoss(event.target.value);
                resetPreview();
              }}
              disabled={operation.status === "saving"}
            />
          </label>
          <button
            type="button"
            onClick={preparePreview}
            disabled={
              !playerId ||
              minimumLoss === "" ||
              Number(minimumLoss) < 0 ||
              operation.status === "preparing" ||
              operation.status === "saving"
            }
          >
            {operation.status === "preparing"
              ? "Pripremam..."
              : "Pripremi preview"}
          </button>
        </section>
      )}

      {preview && (
        <>
          <section className="training-preview-summary">
            <article>
              <span>Analizirani potezi</span>
              <strong>{preview.summary.analyzedMoves}</strong>
            </article>
            <article>
              <span>Ispunjava uvjete</span>
              <strong>{preview.summary.eligibleMoves}</strong>
            </article>
            <article>
              <span>Novi zadaci</span>
              <strong>{preview.summary.toAdd}</strong>
            </article>
            <article>
              <span>Vec postoje</span>
              <strong>{preview.summary.unchanged}</strong>
            </article>
          </section>

          <section className="training-exclusions">
            <span>Iskljuceno iz previewa:</span>
            <strong>{preview.exclusions.good} dobrih poteza</strong>
            <strong>
              {preview.exclusions.belowThreshold} ispod praga
            </strong>
            <strong>
              {preview.exclusions.missingBestMove} bez najboljeg poteza
            </strong>
          </section>

          {preview.warnings.length > 0 && (
            <ul className="training-plan-warnings">
              {preview.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.moveAnalysisId}`}>
                  <strong>{warning.code}</strong> {warning.message}
                </li>
              ))}
            </ul>
          )}

          {preview.conflicts.length > 0 && (
            <ul className="training-plan-warnings">
              {preview.conflicts.map((conflict) => (
                <li key={conflict.taskId}>{conflict.message}</li>
              ))}
            </ul>
          )}

          {preview.toAdd.length > 0 && (
            <section className="training-task-preview">
              <h2>Zadaci za spremanje</h2>
              <div>
                {preview.toAdd.map((task) => (
                  <article key={task.id}>
                    <span className="training-task-priority">
                      prioritet {task.priority}
                    </span>
                    <h3>{task.source.gameTitle}</h3>
                    <p>
                      {PHASE_LABELS[task.phase] || task.phase} ·{" "}
                      {CLASSIFICATION_LABELS[task.classification] ||
                        task.classification}{" "}
                      · {task.centipawnLoss} cp
                    </p>
                    <dl>
                      <div>
                        <dt>Odigrano</dt>
                        <dd>{task.playedMove.san}</dd>
                      </div>
                      <div>
                        <dt>Preporuceno</dt>
                        <dd>{task.bestMove.san}</dd>
                      </div>
                      <div>
                        <dt>Potez</dt>
                        <dd>{task.source.moveNumber}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}

          {preview.canMaterialize && (
            <section className="training-plan-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={operation.status === "saving"}
                />
                <span>
                  Potvrdujem spremanje tocnog skupa prikazanih zadataka.
                </span>
              </label>
              <button
                type="button"
                onClick={saveTasks}
                disabled={!confirmed || operation.status === "saving"}
              >
                {operation.status === "saving"
                  ? "Spremam..."
                  : `Spremi ${preview.summary.toAdd} zadataka`}
              </button>
            </section>
          )}

          {!preview.canMaterialize &&
            preview.summary.toAdd === 0 &&
            preview.summary.unchanged > 0 && (
              <p className="training-plan-message">
                Svi odgovarajuci zadaci vec postoje.
              </p>
            )}
        </>
      )}

      {operation.status === "error" && (
        <p className="training-plan-message training-plan-error">
          {operation.error}
        </p>
      )}
      {operation.status === "success" && (
        <p className="training-plan-message training-plan-success">
          Spremljeno novih zadataka: {operation.result.added}.
        </p>
      )}
    </main>
  );
}
