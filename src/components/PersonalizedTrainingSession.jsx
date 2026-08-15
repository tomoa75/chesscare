import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Link } from "react-router-dom";
import {
  confirmTrainingAttempt,
  createTrainingAttemptPreview,
  loadTrainingSession,
} from "../domain/trainingSessionService";
import {
  createBrowserDomainRepository,
  DOMAIN_STORAGE_CHANGED_EVENT,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../personalizedTrainingSession.css";

const OUTCOME_LABELS = {
  again: "Ponovi",
  hard: "Tesko",
  good: "Dobro",
  easy: "Lako",
};

const PHASE_LABELS = {
  opening: "Otvaranje",
  middlegame: "Sredisnjica",
  endgame: "Zavrsnica",
};

export default function PersonalizedTrainingSession() {
  const [playerId, setPlayerId] = useState("");
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState({
    status: "idle",
    preview: null,
    input: null,
    error: null,
  });
  const [savedMessage, setSavedMessage] = useState("");

  const load = async (selectedPlayerId = playerId) => {
    try {
      const repository = createBrowserDomainRepository(window);
      const data = await loadTrainingSession({
        repository,
        playerId: selectedPlayerId,
      });
      setSession(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error.message);
    }
  };

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const repository = createBrowserDomainRepository(window);
        const data = await loadTrainingSession({ repository, playerId });
        if (active) {
          setSession(data);
          setLoadError(null);
          setAttempt({
            status: "idle",
            preview: null,
            input: null,
            error: null,
          });
        }
      } catch (error) {
        if (active) setLoadError(error.message);
      }
    };

    void refresh();
    const handleStorage = (event) => {
      if (
        event.key === DOMAIN_STORAGE_KEY ||
        event.detail?.key === DOMAIN_STORAGE_KEY
      ) void refresh();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    };
  }, [playerId]);

  const onDrop = (sourceSquare, targetSquare) => {
    const task = session?.currentTask;
    if (!task || attempt.status !== "idle") return false;

    const input = {
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    };
    const attemptedAt = new Date().toISOString();
    setSavedMessage("");
    setAttempt({
      status: "checking",
      preview: null,
      input: { ...input, attemptedAt },
      error: null,
    });

    const prepare = async () => {
      try {
        const repository = createBrowserDomainRepository(window);
        const preview = await createTrainingAttemptPreview({
          repository,
          taskId: task.id,
          attemptedMove: input,
          attemptedAt,
        });
        setAttempt({
          status: "review",
          preview,
          input: { ...input, attemptedAt },
          error: null,
        });
      } catch (error) {
        setAttempt({
          status: "idle",
          preview: null,
          input: null,
          error: error.message,
        });
      }
    };

    void prepare();
    return true;
  };

  const recordOutcome = async (outcome) => {
    if (!attempt.preview || !attempt.input) return;
    setAttempt((current) => ({ ...current, status: "saving", error: null }));

    try {
      const repository = createBrowserDomainRepository(window);
      const result = await confirmTrainingAttempt({
        repository,
        taskId: attempt.preview.task.id,
        attemptedMove: {
          from: attempt.input.from,
          to: attempt.input.to,
          promotion: attempt.input.promotion,
        },
        attemptedAt: attempt.input.attemptedAt,
        outcome,
        previewToken: attempt.preview.token,
      });
      setSavedMessage(
        result.status === "already-recorded"
          ? "Ovaj pokusaj vec je bio spremljen."
          : `Pokusaj je spremljen. Sljedece ponavljanje za ${result.task.schedule.intervalDays} dana.${
              result.priorityAdjustment.increment > 0
                ? ` Prioritet ${result.priorityAdjustment.adjustedTaskIds.length} povezanih zadataka povecan je za ${result.priorityAdjustment.increment}.`
                : ""
            }`,
      );
      setAttempt({
        status: "idle",
        preview: null,
        input: null,
        error: null,
      });
      await load(playerId);
    } catch (error) {
      setAttempt((current) => ({
        ...current,
        status: "review",
        error: error.message,
      }));
    }
  };

  if (loadError) {
    return (
      <main className="training-session-page">
        <section className="training-session-state training-session-error">
          <h1>Trening session nije dostupan</h1>
          <p>{loadError}</p>
          <p>Podaci nisu promijenjeni.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="training-session-page">
        <section className="training-session-state">
          Ucitavam dospjele zadatke...
        </section>
      </main>
    );
  }

  const task = session.currentTask;
  const boardPosition = attempt.preview?.resultingFen || task?.fen;

  return (
    <main className="training-session-page">
      <header className="training-session-header">
        <div>
          <span>Spaced repetition</span>
          <h1>Vjezbaj svoje pozicije</h1>
          <p>
            Odigraj najbolji potez iz spremljene analize. Stockfish se ovdje
            ne pokrece; rjesenje dolazi iz potvrdenog trening zadatka.
          </p>
        </div>
        <label>
          <span>Profil igraca</span>
          <select
            value={playerId}
            onChange={(event) => {
              setPlayerId(event.target.value);
              setSavedMessage("");
            }}
            disabled={attempt.status === "saving"}
          >
            <option value="">Odaberi profil</option>
            {session.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.displayName} ({player.dueTasks} dospjelo)
              </option>
            ))}
          </select>
        </label>
      </header>

      {!playerId ? (
        <section className="training-session-state">
          <h2>Odaberi profil za trening</h2>
          <p>Dospjeli zadaci prikazat ce se prema prioritetu.</p>
        </section>
      ) : session.selectedPlayer?.id !== playerId ? (
        <section className="training-session-state">
          Ucitavam dospjele zadatke...
        </section>
      ) : !task ? (
        <section className="training-session-state">
          <h2>Nema dospjelih zadataka</h2>
          <p>
            Trenutno je dovrseno sve sto je bilo na rasporedu za{" "}
            {session.selectedPlayer.displayName}.
          </p>
          <Link to="/training-plan">Pripremi nove zadatke</Link>
        </section>
      ) : (
        <>
          <section className="training-session-progress">
            <div>
              <span>Dospjelo</span>
              <strong>{session.summary.dueTasks}</strong>
            </div>
            <div>
              <span>Ukupno zadataka</span>
              <strong>{session.summary.totalTasks}</strong>
            </div>
            <div>
              <span>Dosadasnji pokusaji</span>
              <strong>{session.summary.completedAttempts}</strong>
            </div>
          </section>

          <section className="training-session-workspace">
            <div className="training-board-panel">
              <div className="training-board-heading">
                <span>
                  Na potezu: {task.color === "white" ? "bijeli" : "crni"}
                </span>
                <strong>Pronadi najbolji potez</strong>
              </div>
              <Chessboard
                position={boardPosition}
                boardOrientation={task.color}
                onPieceDrop={onDrop}
                arePiecesDraggable={attempt.status === "idle"}
              />
            </div>

            <aside className="training-task-context">
              <span className="training-context-priority">
                Prioritet {task.priority}
              </span>
              <h2>{task.source.gameTitle}</h2>
              <dl>
                <div>
                  <dt>Faza</dt>
                  <dd>{PHASE_LABELS[task.phase] || task.phase}</dd>
                </div>
                <div>
                  <dt>Izvorni potez</dt>
                  <dd>
                    {task.source.moveNumber}. {task.playedMove.san}
                  </dd>
                </div>
                <div>
                  <dt>Gubitak</dt>
                  <dd>{task.centipawnLoss} cp</dd>
                </div>
                <div>
                  <dt>Slabost</dt>
                  <dd>{task.weaknessKey}</dd>
                </div>
              </dl>

              {attempt.status === "checking" && (
                <p className="training-attempt-checking">
                  Provjeravam potez...
                </p>
              )}

              {attempt.preview && (
                <div
                  className={
                    attempt.preview.correct
                      ? "training-attempt-result training-attempt-correct"
                      : "training-attempt-result training-attempt-wrong"
                  }
                >
                  <h3>
                    {attempt.preview.correct
                      ? "Tocan potez"
                      : "Pokusaj nije medu preporucenim potezima"}
                  </h3>
                  <p>
                    Odigrano: <strong>{attempt.preview.attemptedMove.san}</strong>
                  </p>
                  <p>
                    Najbolji potez:{" "}
                    <strong>{attempt.preview.expectedMove.san}</strong>
                  </p>
                  <div className="training-outcomes">
                    {attempt.preview.allowedOutcomes.map((outcome) => (
                      <button
                        type="button"
                        key={outcome}
                        onClick={() => recordOutcome(outcome)}
                        disabled={attempt.status === "saving"}
                      >
                        {OUTCOME_LABELS[outcome]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="training-reset-attempt"
                    onClick={() =>
                      setAttempt({
                        status: "idle",
                        preview: null,
                        input: null,
                        error: null,
                      })
                    }
                    disabled={attempt.status === "saving"}
                  >
                    Pokusaj drugi potez bez spremanja
                  </button>
                </div>
              )}

              {attempt.error && (
                <p className="training-session-inline-error">
                  {attempt.error}
                </p>
              )}
            </aside>
          </section>
        </>
      )}

      {savedMessage && (
        <p className="training-session-message">{savedMessage}</p>
      )}
    </main>
  );
}
