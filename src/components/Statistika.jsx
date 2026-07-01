/*
import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { loadSavedGames, subscribeToSavedGames } from "../gameStorage";
import "../statistika.css";

const PIECE_NAMES = {
  p: "Pjesaci",
  n: "Skakaci",
  b: "Lovci",
  r: "Topovi",
  q: "Dame",
  k: "Kraljevi",
};

const RESULT_LABELS = {
  "1-0": "Pobjede bijelog",
  "0-1": "Pobjede crnog",
  "1/2-1/2": "Remiji",
  "*": "Bez rezultata",
};

function createCounter() {
  return new Map();
}

function addCount(counter, key, amount = 1) {
  const safeKey = key || "Nepoznato";
  counter.set(safeKey, (counter.get(safeKey) || 0) + amount);
}

function topEntries(counter, limit = 8) {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function percent(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function average(value, total, decimals = 1) {
  if (!total) return "0";
  return (value / total).toFixed(decimals);
}

function normalizeResult(result) {
  return RESULT_LABELS[result] ? result : "*";
}

function getOpeningName(headers) {
  const eco = headers.ECO ? `${headers.ECO} ` : "";
  const opening = headers.Opening || headers.Variant || "Nepoznato otvaranje";
  const variation = headers.Variation ? `: ${headers.Variation}` : "";

  return `${eco}${opening}${variation}`;
}

function getGamePhase(moveCount) {
  if (moveCount <= 25) return "kratka partija";
  if (moveCount <= 45) return "srednje duga partija";
  if (moveCount <= 70) return "duga partija";
  return "maraton";
}

function getMaterialSummary(game) {
  const material = {
    white: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    black: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };

  game.board().forEach((row) => {
    row.forEach((piece) => {
      if (piece && piece.type !== "k") {
        material[piece.color === "w" ? "white" : "black"][piece.type] += 1;
      }
    });
  });

  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const whiteValue = Object.entries(material.white).reduce(
    (sum, [piece, count]) => sum + values[piece] * count,
    0,
  );
  const blackValue = Object.entries(material.black).reduce(
    (sum, [piece, count]) => sum + values[piece] * count,
    0,
  );

  return { whiteValue, blackValue };
}

function analyzeGame(record, index) {
  const game = new Chess();
  game.loadPgn(record.pgn);

  const headers = game.header();
  const moves = game.history({ verbose: true });
  const result = normalizeResult(headers.Result || "*");
  const white = headers.White || "Bijeli";
  const black = headers.Black || "Crni";
  const event = headers.Event || "Partija";
  const opening = getOpeningName(headers);
  const material = getMaterialSummary(game);
  const moveCount = Math.ceil(moves.length / 2);

  const metrics = moves.reduce(
    (data, move, moveIndex) => {
      if (move.captured) data.captures += 1;
      if (move.san.includes("+") || move.san.includes("#")) data.checks += 1;
      if (move.san.includes("#")) data.mates += 1;
      if (move.san.includes("=") || move.promotion) data.promotions += 1;
      if (move.san === "O-O") data.castlesKingSide += 1;
      if (move.san === "O-O-O") data.castlesQueenSide += 1;
      if (moveIndex < 20) data.openingMoves.push(move.san);
      data.pieceMoves[move.piece] += 1;
      return data;
    },
    {
      captures: 0,
      checks: 0,
      mates: 0,
      promotions: 0,
      castlesKingSide: 0,
      castlesQueenSide: 0,
      openingMoves: [],
      pieceMoves: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    },
  );

  return {
    id: record.id || `${index}`,
    title: record.title || `${event}: ${white} - ${black}`,
    event,
    white,
    black,
    result,
    opening,
    moveCount,
    plyCount: moves.length,
    phase: getGamePhase(moveCount),
    firstMove: moves[0]?.san || "Nema poteza",
    lastMove: moves[moves.length - 1]?.san || "-",
    ...metrics,
    materialDiff: material.whiteValue - material.blackValue,
    finalFen: game.fen(),
  };
}

function buildStats(savedGames) {
  const games = savedGames
    .map((record, index) => {
      try {
        return analyzeGame(record, index);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const totals = {
    games: games.length,
    plies: 0,
    moves: 0,
    captures: 0,
    checks: 0,
    mates: 0,
    promotions: 0,
    castlesKingSide: 0,
    castlesQueenSide: 0,
  };

  const results = createCounter();
  const openings = createCounter();
  const firstMoves = createCounter();
  const players = createCounter();
  const phases = createCounter();
  const pieceMoves = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const playerScore = new Map();

  games.forEach((game) => {
    totals.plies += game.plyCount;
    totals.moves += game.moveCount;
    totals.captures += game.captures;
    totals.checks += game.checks;
    totals.mates += game.mates;
    totals.promotions += game.promotions;
    totals.castlesKingSide += game.castlesKingSide;
    totals.castlesQueenSide += game.castlesQueenSide;

    addCount(results, game.result);
    addCount(openings, game.opening);
    addCount(firstMoves, game.firstMove);
    addCount(players, game.white);
    addCount(players, game.black);
    addCount(phases, game.phase);

    Object.keys(pieceMoves).forEach((piece) => {
      pieceMoves[piece] += game.pieceMoves[piece];
    });

    updatePlayerScore(playerScore, game.white, "white", game.result);
    updatePlayerScore(playerScore, game.black, "black", game.result);
  });

  const longestGame = games.reduce(
    (longest, game) => (game.moveCount > longest.moveCount ? game : longest),
    { moveCount: 0 },
  );
  const sharpestGame = games.reduce(
    (sharpest, game) =>
      game.captures + game.checks > sharpest.captures + sharpest.checks
        ? game
        : sharpest,
    { captures: 0, checks: 0 },
  );

  return {
    games,
    totals,
    results,
    openings,
    firstMoves,
    players,
    phases,
    pieceMoves,
    playerScore,
    longestGame,
    sharpestGame,
  };
}

function updatePlayerScore(playerScore, name, color, result) {
  const current = playerScore.get(name) || {
    name,
    games: 0,
    score: 0,
    whiteGames: 0,
    blackGames: 0,
  };

  current.games += 1;
  current.whiteGames += color === "white" ? 1 : 0;
  current.blackGames += color === "black" ? 1 : 0;

  if (result === "1/2-1/2") {
    current.score += 0.5;
  } else if (
    (color === "white" && result === "1-0") ||
    (color === "black" && result === "0-1")
  ) {
    current.score += 1;
  }

  playerScore.set(name, current);
}

function StatBarList({ items, total }) {
  if (items.length === 0) {
    return <p className="stats-muted">Nema podataka.</p>;
  }

  return (
    <div className="stats-bars">
      {items.map((item) => (
        <div className="stats-bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="stats-bar-track">
            <div
              className="stats-bar-fill"
              style={{ width: percent(item.value, total) }}
            />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Statistika() {
  const [savedGames, setSavedGames] = useState(() => loadSavedGames());

  useEffect(() => subscribeToSavedGames(setSavedGames), []);

  const stats = useMemo(() => buildStats(savedGames), [savedGames]);
  const totalGames = stats.totals.games;
  const resultRows = topEntries(stats.results, 4).map((entry) => ({
    ...entry,
    label: RESULT_LABELS[entry.label],
  }));
  const pieceRows = Object.entries(stats.pieceMoves)
    .map(([piece, value]) => ({ label: PIECE_NAMES[piece], value }))
    .sort((a, b) => b.value - a.value);
  const playerRows = Array.from(stats.playerScore.values())
    .sort((a, b) => b.score - a.score || b.games - a.games)
    .slice(0, 10);

  if (totalGames === 0) {
    return (
      <main className="stats-page">
        <div className="stats-empty">
          <h1>Statistika partija</h1>
          <p>U Importu prvo ucitaj PGN datoteku s jednom ili vise partija.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="stats-page">
      <header className="stats-header">
        <div>
          <h1>Statistika partija</h1>
          <p>
            Analizirano je svih {totalGames} spremljenih PGN partija iz Importa.
          </p>
        </div>
        <span className="stats-pill">{stats.totals.plies} polupoteza</span>
      </header>

      <section className="stats-grid">
        <article className="stats-card">
          <span>Prosjecna duljina</span>
          <strong>{average(stats.totals.moves, totalGames)}</strong>
          <small>poteza po partiji</small>
        </article>
        <article className="stats-card">
          <span>Takticki dogadaji</span>
          <strong>{stats.totals.captures + stats.totals.checks}</strong>
          <small>
            {stats.totals.captures} uzimanja, {stats.totals.checks} sahova
          </small>
        </article>
        <article className="stats-card">
          <span>Rokade</span>
          <strong>
            {stats.totals.castlesKingSide + stats.totals.castlesQueenSide}
          </strong>
          <small>
            kratka {stats.totals.castlesKingSide}, duga{" "}
            {stats.totals.castlesQueenSide}
          </small>
        </article>
        <article className="stats-card">
          <span>Promocije i matovi</span>
          <strong>{stats.totals.promotions + stats.totals.mates}</strong>
          <small>
            {stats.totals.promotions} promocija, {stats.totals.mates} matova
          </small>
        </article>
      </section>

      <div className="stats-layout">
        <div className="stats-stack">
          <section className="stats-section">
            <h2>Rezultati</h2>
            <StatBarList items={resultRows} total={totalGames} />
          </section>

          <section className="stats-section">
            <h2>Najcesca otvaranja</h2>
            <StatBarList items={topEntries(stats.openings, 10)} total={totalGames} />
          </section>

          <section className="stats-section">
            <h2>Pregled svih partija</h2>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Partija</th>
                  <th>Rezultat</th>
                  <th>Otvaranje</th>
                  <th>Potezi</th>
                  <th>Sahovski trag</th>
                </tr>
              </thead>
              <tbody>
                {stats.games.map((game, index) => (
                  <tr key={game.id}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>
                        {game.white} - {game.black}
                      </strong>
                      <div className="stats-muted">{game.event}</div>
                    </td>
                    <td>{game.result}</td>
                    <td>{game.opening}</td>
                    <td>{game.moveCount}</td>
                    <td>
                      {game.captures} uzimanja, {game.checks} sahova, zadnje{" "}
                      {game.lastMove}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="stats-stack">
          <section className="stats-section">
            <h2>Prvi potezi</h2>
            <StatBarList items={topEntries(stats.firstMoves, 8)} total={totalGames} />
          </section>

          <section className="stats-section">
            <h2>Aktivnost figura</h2>
            <StatBarList items={pieceRows} total={stats.totals.plies} />
          </section>

          <section className="stats-section">
            <h2>Igraci</h2>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Igrac</th>
                  <th>Partije</th>
                  <th>Bodovi</th>
                  <th>Ucinak</th>
                </tr>
              </thead>
              <tbody>
                {playerRows.map((player) => (
                  <tr key={player.name}>
                    <td>{player.name}</td>
                    <td>{player.games}</td>
                    <td>{player.score}</td>
                    <td>{percent(player.score, player.games)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="stats-section">
            <h2>Tip partija</h2>
            <div className="stats-tags">
              {topEntries(stats.phases, 6).map((phase) => (
                <span className="stats-tag" key={phase.label}>
                  {phase.label}: {phase.value}
                </span>
              ))}
            </div>
          </section>

          <section className="stats-section">
            <h2>Istaknuto</h2>
            <p className="stats-muted">
              Najduza partija: {stats.longestGame.title} (
              {stats.longestGame.moveCount} poteza).
            </p>
            <p className="stats-muted">
              Najostrija partija: {stats.sharpestGame.title} (
              {stats.sharpestGame.captures} uzimanja i {stats.sharpestGame.checks}{" "}
              sahova).
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

*/
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { loadSavedGames, subscribeToSavedGames } from "../gameStorage";
import "../statistika.css";

const STOCKFISH_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
const DEFAULT_ANALYSIS_DEPTH = 8;
const MIN_ANALYSIS_DEPTH = 4;
const MAX_ANALYSIS_DEPTH = 20;
const PHASES = ["Otvaranje", "Sredisnjica", "Zavrsnica"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreToWhitePerspective(score, fen) {
  const sideToMove = fen.split(" ")[1];
  const value =
    score.type === "mate"
      ? Math.sign(score.value) * 100000
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
