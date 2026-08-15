import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { loadSavedGames, subscribeToSavedGames } from "../gameStorage";
import "../statistika.css";

const STOCKFISH_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
const DEFAULT_ANALYSIS_DEPTH = 8;
const MIN_ANALYSIS_DEPTH = 4;
const MAX_ANALYSIS_DEPTH = 20;
const PHASES = ["Otvaranje", "Sredisnjica", "Zavrsnica"];
const MATE_SCORE = 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreToWhitePerspective(score, fen) {
  const sideToMove = fen.split(" ")[1];
  const mateDirection = score.value >= 0 ? 1 : -1;
  const mateDistance = Math.min(Math.abs(score.value), 100);
  const value = score.type === "mate"
    ? mateDirection * (MATE_SCORE - mateDistance)
    : Number(score.value);

  return sideToMove === "w" ? value : -value;
}

function parseEngineScore(line, fen) {
  const match = line.match(/score (cp|mate) (-?\d+)/);
  if (!match) return null;

  return scoreToWhitePerspective(
    { type: match[1], value: Number(match[2]) },
    fen,
  );
}

function materialValue(chess) {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  return chess.board().reduce(
    (sum, row) =>
      sum +
      row.reduce((rowSum, piece) => {
        if (!piece || piece.type === "k") return rowSum;
        return rowSum + values[piece.type];
      }, 0),
    0,
  );
}

function hasQueens(chess) {
  return chess.board().some((row) =>
    row.some((piece) => piece?.type === "q"),
  );
}

function getPhase(chess, plyIndex) {
  const fullMove = Math.floor(plyIndex / 2) + 1;

  if (fullMove <= 10) return "Otvaranje";
  if (fullMove >= 35 || (!hasQueens(chess) && materialValue(chess) <= 24)) {
    return "Zavrsnica";
  }

  return "Sredisnjica";
}

function classifyLoss(loss) {
  if (loss >= 200) return "Gruba greska";
  if (loss >= 100) return "Greska";
  if (loss >= 50) return "Nepreciznost";
  return "Dobar potez";
}

function accuracyFromAverageLoss(averageLoss) {
  return clamp(100 * Math.exp(-averageLoss / 220), 0, 100);
}

function createEmptyPlayer(name) {
  return {
    name,
    moves: 0,
    totalLoss: 0,
    captures: 0,
    checks: 0,
    queenMoves: 0,
    castleMoves: 0,
    phaseLoss: Object.fromEntries(PHASES.map((phase) => [phase, 0])),
    phaseMoves: Object.fromEntries(PHASES.map((phase) => [phase, 0])),
    phaseErrors: Object.fromEntries(PHASES.map((phase) => [phase, 0])),
    labels: {
      "Dobar potez": 0,
      Nepreciznost: 0,
      Greska: 0,
      "Gruba greska": 0,
    },
    worstMoves: [],
  };
}

function createStockfish() {
  return new Promise((resolve, reject) => {
    let worker;

    try {
      worker = new Worker(STOCKFISH_URL);
    } catch (error) {
      reject(error);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Stockfish se nije javio na vrijeme."));
    }, 15000);

    worker.onerror = (event) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      reject(event);
    };

    worker.onmessage = (event) => {
      const line = String(event.data);

      if (line === "uciok") {
        worker.postMessage("setoption name MultiPV value 1");
        worker.postMessage("isready");
      }

      if (line === "readyok") {
        window.clearTimeout(timeoutId);
        resolve(worker);
      }
    };

    worker.postMessage("uci");
  });
}

function evaluateFen(worker, fen, depth) {
  const position = new Chess(fen);

  if (position.isCheckmate()) {
    return Promise.resolve(position.turn() === "w" ? -MATE_SCORE : MATE_SCORE);
  }

  return new Promise((resolve) => {
    let latestScore = 0;

    worker.onmessage = (event) => {
      const line = String(event.data);

      if (line.startsWith("info") && line.includes(" score ")) {
        const parsedScore = parseEngineScore(line, fen);
        if (parsedScore !== null) latestScore = parsedScore;
      }

      if (line.startsWith("bestmove")) {
        resolve(latestScore);
      }
    };

    worker.postMessage("stop");
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth}`);
  });
}

function buildMoveTasks(savedGames) {
  return savedGames.flatMap((record, gameIndex) => {
    try {
      const loadedGame = new Chess();
      loadedGame.loadPgn(record.pgn);

      const headers = loadedGame.header();
      const white = headers.White || "Bijeli";
      const black = headers.Black || "Crni";
      const event = headers.Event || record.title || `Partija ${gameIndex + 1}`;
      const replay = new Chess();

      return loadedGame.history({ verbose: true }).map((move, plyIndex) => {
        const beforeFen = replay.fen();
        const phase = getPhase(replay, plyIndex);
        const playerColor = replay.turn();
        const playedMove = replay.move(move.san);

        return {
          id: `${record.id}-${plyIndex}`,
          gameTitle: `${event}: ${white} - ${black}`,
          player: playerColor === "w" ? white : black,
          color: playerColor,
          san: playedMove.san,
          moveNumber: Math.floor(plyIndex / 2) + 1,
          phase,
          beforeFen,
          afterFen: replay.fen(),
          isCapture: Boolean(playedMove.captured),
          isCheck: playedMove.san.includes("+") || playedMove.san.includes("#"),
          isQueenMove: playedMove.piece === "q",
          isCastle: playedMove.san === "O-O" || playedMove.san === "O-O-O",
        };
      });
    } catch {
      return [];
    }
  });
}

function describeStyle(player) {
  const tacticalRatio = (player.captures + player.checks) / Math.max(1, player.moves);
  const queenRatio = player.queenMoves / Math.max(1, player.moves);
  const averageLoss = player.totalLoss / Math.max(1, player.moves);
  const blunderRatio = player.labels["Gruba greska"] / Math.max(1, player.moves);

  if (blunderRatio >= 0.08) return "Riskantan stil - stvara sanse, ali previse poklanja.";
  if (tacticalRatio >= 0.36) return "Takticki stil - cesto trazi forsirane poteze, uzimanja i sahove.";
  if (averageLoss <= 45 && tacticalRatio < 0.24) {
    return "Strateski stil - mirnija igra, dobra kontrola pozicije i manje oscilacija.";
  }
  if (queenRatio >= 0.14) return "Aktivan stil - rano i cesto koristi teske figure.";

  return "Uravnotezen stil - mijesa taktiku i pozicijsku igru.";
}

function summarizePlayer(rawPlayer) {
  const averageLoss = rawPlayer.totalLoss / Math.max(1, rawPlayer.moves);
  const phaseAverages = PHASES.map((phase) => ({
    phase,
    moves: rawPlayer.phaseMoves[phase],
    averageLoss:
      rawPlayer.phaseLoss[phase] / Math.max(1, rawPlayer.phaseMoves[phase]),
    errors: rawPlayer.phaseErrors[phase],
  }));
  const weakestPhase = phaseAverages
    .filter((phase) => phase.moves > 0)
    .sort((a, b) => b.averageLoss - a.averageLoss)[0];

  return {
    ...rawPlayer,
    averageLoss,
    accuracy: accuracyFromAverageLoss(averageLoss),
    weakestPhase: weakestPhase?.phase || "Nema dovoljno poteza",
    phaseAverages,
    style: describeStyle(rawPlayer),
    worstMoves: rawPlayer.worstMoves
      .sort((a, b) => b.loss - a.loss)
      .slice(0, 5),
  };
}

function buildReport(tasks, scores) {
  const players = new Map();

  tasks.forEach((task) => {
    const beforeWhiteScore = scores.get(task.beforeFen) || 0;
    const afterWhiteScore = scores.get(task.afterFen) || 0;
    const beforePlayerScore =
      task.color === "w" ? beforeWhiteScore : -beforeWhiteScore;
    const afterPlayerScore = task.color === "w" ? afterWhiteScore : -afterWhiteScore;
    const loss = Math.max(0, beforePlayerScore - afterPlayerScore);
    const label = classifyLoss(loss);
    const player = players.get(task.player) || createEmptyPlayer(task.player);

    player.moves += 1;
    player.totalLoss += loss;
    player.phaseMoves[task.phase] += 1;
    player.phaseLoss[task.phase] += loss;
    player.labels[label] += 1;
    player.captures += task.isCapture ? 1 : 0;
    player.checks += task.isCheck ? 1 : 0;
    player.queenMoves += task.isQueenMove ? 1 : 0;
    player.castleMoves += task.isCastle ? 1 : 0;

    if (loss >= 50) {
      player.phaseErrors[task.phase] += 1;
      player.worstMoves.push({
        ...task,
        loss,
        label,
      });
    }

    players.set(task.player, player);
  });

  return Array.from(players.values())
    .map(summarizePlayer)
    .sort((a, b) => b.accuracy - a.accuracy);
}

function formatCp(value) {
  return `${Math.round(value)} cp`;
}

function formatAccuracy(value) {
  return `${value.toFixed(1)}%`;
}

function Statistika() {
  const workerRef = useRef(null);
  const [savedGames, setSavedGames] = useState(() => loadSavedGames());
  const [status, setStatus] = useState("Spremno za Stockfish analizu.");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisDepth, setAnalysisDepth] = useState(DEFAULT_ANALYSIS_DEPTH);

  useEffect(() => subscribeToSavedGames(setSavedGames), []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );

  const tasks = useMemo(() => buildMoveTasks(savedGames), [savedGames]);

  async function startAnalysis() {
    if (tasks.length === 0 || isAnalyzing) return;

    setIsAnalyzing(true);
    setReport([]);
    setStatus("Pokrecem Stockfish...");

    try {
      workerRef.current?.terminate();
      const worker = await createStockfish();
      workerRef.current = worker;
      const uniqueFens = Array.from(
        new Set(tasks.flatMap((task) => [task.beforeFen, task.afterFen])),
      );
      const scores = new Map();

      setProgress({ done: 0, total: uniqueFens.length });

      for (let index = 0; index < uniqueFens.length; index += 1) {
        const fen = uniqueFens[index];
        setStatus(`Stockfish analizira poziciju ${index + 1}/${uniqueFens.length}`);
        scores.set(fen, await evaluateFen(worker, fen, analysisDepth));
        setProgress({ done: index + 1, total: uniqueFens.length });
      }

      setReport(buildReport(tasks, scores));
      setStatus("Analiza zavrsena.");
      worker.terminate();
      workerRef.current = null;
    } catch (error) {
      console.error("Stockfish analiza nije uspjela:", error);
      setStatus("Stockfish analiza nije uspjela. Provjeri worker datoteke.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (savedGames.length === 0) {
    return (
      <main className="stats-page">
        <div className="stats-empty">
          <h1>Stockfish statistika</h1>
          <p>U Importu prvo ucitaj PGN datoteku s jednom ili vise partija.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="stats-page">
      <header className="stats-header">
        <div>
          <h1>Stockfish statistika</h1>
          <p>
            Analiza svih uvezenih partija: preciznost igraca, faze gresaka i
            stil igre.
          </p>
        </div>
        <div className="stats-analysis-controls">
          <label className="stats-depth-control">
            <span>Dubina analize: {analysisDepth}</span>
            <input
              type="range"
              min={MIN_ANALYSIS_DEPTH}
              max={MAX_ANALYSIS_DEPTH}
              step="1"
              value={analysisDepth}
              onChange={(event) => setAnalysisDepth(Number(event.target.value))}
              disabled={isAnalyzing}
            />
          </label>
          <button
            className="stats-action"
            type="button"
            onClick={startAnalysis}
            disabled={isAnalyzing || tasks.length === 0}
          >
            {isAnalyzing ? "Analiziram..." : "Pokreni analizu"}
          </button>
        </div>
      </header>

      <section className="stats-section">
        <div className="stats-progress-header">
          <strong>{status}</strong>
          <span>
            {progress.total > 0 ? `${progress.done}/${progress.total}` : "0/0"}
          </span>
        </div>
        <div className="stats-bar-track">
          <div
            className="stats-bar-fill"
            style={{
              width:
                progress.total > 0
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : "0%",
            }}
          />
        </div>
        <p className="stats-muted">
          Odabrana dubina je {analysisDepth}. Veca dubina je preciznija, ali puno
          sporija za datoteke s vise partija.
        </p>
      </section>

      {report.length === 0 ? (
        <section className="stats-empty">
          <h2>Nema Stockfish izvjestaja</h2>
          <p>
            Klikni “Pokreni analizu” i pricekaj da engine prode kroz sve pozicije.
          </p>
        </section>
      ) : (
        <>
          <section className="stats-grid">
            {report.map((player) => (
              <article className="stats-card" key={player.name}>
                <span>{player.name}</span>
                <strong>{formatAccuracy(player.accuracy)}</strong>
                <small>
                  prosjecni gubitak {formatCp(player.averageLoss)} po potezu
                </small>
              </article>
            ))}
          </section>

          <div className="stats-layout">
            <div className="stats-stack">
              {report.map((player) => (
                <section className="stats-section" key={player.name}>
                  <h2>{player.name}</h2>
                  <div className="stats-player-summary">
                    <span>Preciznost: {formatAccuracy(player.accuracy)}</span>
                    <span>Najslabija faza: {player.weakestPhase}</span>
                    <span>{player.style}</span>
                  </div>

                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Faza</th>
                        <th>Prosj. gubitak</th>
                        <th>Greske</th>
                        <th>Potezi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {player.phaseAverages.map((phase) => (
                        <tr key={phase.phase}>
                          <td>{phase.phase}</td>
                          <td>{formatCp(phase.averageLoss)}</td>
                          <td>{phase.errors}</td>
                          <td>{phase.moves}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>

            <aside className="stats-stack">
              {report.map((player) => (
                <section className="stats-section" key={`${player.name}-errors`}>
                  <h2>Najvece greske: {player.name}</h2>
                  {player.worstMoves.length > 0 ? (
                    <ol className="stats-move-list">
                      {player.worstMoves.map((move) => (
                        <li key={move.id}>
                          <strong>
                            {move.moveNumber}. {move.san}
                          </strong>
                          <span>
                            {move.label}, {formatCp(move.loss)} izgubljeno
                          </span>
                          <small>
                            {move.phase} - {move.gameTitle}
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="stats-muted">
                      Nema poteza s gubitkom vecim od 50 centipawnova.
                    </p>
                  )}
                </section>
              ))}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

export default Statistika;
