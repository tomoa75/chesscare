import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import "../trening.css"; // Uvezi CSS datoteku za dodatne stilove
import { loadSavedGames, subscribeToSavedGames } from "../gameStorage";

// Izbriši staru liniju i stavi ovu:
const STOCKFISH_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
const ANALYSIS_DEPTH = 12;
const MULTI_PV = 3;
const MAIN_LINE_ID = "main";

function getFenAtPly(moves, ply) {
  const chess = new Chess();

  moves.slice(0, ply).forEach((move) => {
    chess.move(move.san);
  });

  return chess.fen();
}

function formatScore(type, value, fen) {
  const sideToMove = fen.split(" ")[1];
  const multiplier = sideToMove === "b" ? -1 : 1;
  const broj = Number(value) * multiplier;

  if (type === "mate") {
    return `M${broj}`;
  }

  return `${broj >= 0 ? "+" : ""}${(broj / 100).toFixed(2)}`;
}

function uciToSan(fen, move) {
  if (!move || move === "(none)") return "";

  try {
    const chess = new Chess(fen);
    const odigraniPotez = chess.move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      promotion: move[4],
    });

    return odigraniPotez?.san || move;
  } catch {
    return move;
  }
}

function pvToSan(fen, pv) {
  try {
    const chess = new Chess(fen);

    return pv
      .split(" ")
      .map((move) => {
        const odigraniPotez = chess.move({
          from: move.slice(0, 2),
          to: move.slice(2, 4),
          promotion: move[4],
        });

        return odigraniPotez?.san || move;
      })
      .join(" ");
  } catch {
    return pv;
  }
}

function parseAnalysisLine(line, fen) {
  const match = line.match(
    /depth (\d+).*?multipv (\d+).*?score (cp|mate) (-?\d+).*?pv (.+)/,
  );

  if (!match) return null;

  const [, depth, multipv, scoreType, scoreValue, pv] = match;
  const moves = pv.trim().split(" ");
  const bestMove = moves[0];

  return {
    depth: Number(depth),
    id: Number(multipv),
    score: formatScore(scoreType, scoreValue, fen),
    bestMove: uciToSan(fen, bestMove),
    pv: pvToSan(fen, pv),
  };
}

export default function Trening() {
  const engineRef = useRef(null);
  const fenRef = useRef("");

  const [savedGames, setSavedGames] = useState(() => loadSavedGames());
  const [selectedSavedGameId, setSelectedSavedGameId] = useState("");
  const [lines, setLines] = useState([
    { id: MAIN_LINE_ID, name: "Glavna linija", moves: [] },
  ]);
  const [activeLineId, setActiveLineId] = useState(MAIN_LINE_ID);
  const [currentPly, setCurrentPly] = useState(0);
  const [engineStatus, setEngineStatus] = useState("Ucitavanje Stockfisha...");
  const [engineReady, setEngineReady] = useState(false);
  const [analize, setAnalize] = useState([]);
  const [boardOrientation, setBoardOrientation] = useState("white");
  const [nextVariationNumber, setNextVariationNumber] = useState(1);

  const activeLine = useMemo(
    () => lines.find((line) => line.id === activeLineId) || lines[0],
    [activeLineId, lines],
  );
  const moveHistory = activeLine.moves;

  const fen = useMemo(
    () => getFenAtPly(moveHistory, currentPly),
    [currentPly, moveHistory],
  );
  const igraJeGotova = useMemo(() => new Chess(fen).isGameOver(), [fen]);
  const isAtLatestMove = currentPly === moveHistory.length;

  const redoviPoteza = useMemo(
    () =>
      moveHistory.reduce((redovi, move, index) => {
        const rowIndex = Math.floor(index / 2);
        const red =
          redovi[rowIndex] ||
          (redovi[rowIndex] = {
            broj: rowIndex + 1,
            bijeli: null,
            crni: null,
          });

        if (index % 2 === 0) {
          red.bijeli = { san: move.san, ply: index + 1 };
        } else {
          red.crni = { san: move.san, ply: index + 1 };
        }

        return redovi;
      }, []),
    [moveHistory],
  );

  const navigationLabel =
    currentPly === 0
      ? `${activeLine.name}: pocetna pozicija`
      : `${activeLine.name}: potez ${currentPly}/${moveHistory.length}`;

  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  useEffect(() => subscribeToSavedGames(setSavedGames), []);

  useEffect(() => {
    let engine;

    try {
      engine = new Worker(STOCKFISH_URL);
    } catch (error) {
      console.error("Stockfish worker se nije mogao ucitati:", error);
      const timeoutId = window.setTimeout(() => {
        setEngineStatus("Stockfish datoteka nije dostupna");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    engineRef.current = engine;

    engine.onmessage = (event) => {
      const line = String(event.data);

      if (line === "uciok") {
        engine.postMessage(`setoption name MultiPV value ${MULTI_PV}`);
        engine.postMessage("isready");
        return;
      }

      if (line === "readyok") {
        setEngineReady(true);
        setEngineStatus("Stockfish 18 spreman");
        return;
      }

      if (line.startsWith("info") && line.includes(" pv ")) {
        const parsed = parseAnalysisLine(line, fenRef.current);

        if (!parsed) return;

        setAnalize((trenutneAnalize) => {
          const bezStare = trenutneAnalize.filter(
            (analiza) => analiza.id !== parsed.id,
          );

          return [...bezStare, parsed].sort((a, b) => a.id - b.id);
        });
      }

      if (line.startsWith("bestmove")) {
        setEngineStatus("Analiza zavrsena");
      }
    };

    engine.onerror = () => {
      setEngineReady(false);
      setEngineStatus("Stockfish se nije uspio pokrenuti");
    };

    engine.postMessage("uci");

    return () => {
      engine.postMessage("quit");
      engine.terminate();
      engineRef.current = null;
      setEngineReady(false);
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;

    if (!engine || !engineReady) return;

    if (igraJeGotova) {
      const timeoutId = window.setTimeout(() => {
        setAnalize([]);
        setEngineStatus("Partija je gotova");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    engine.postMessage("stop");
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${ANALYSIS_DEPTH}`);

    const timeoutId = window.setTimeout(() => {
      setAnalize([]);
      setEngineStatus("Stockfish analizira...");
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      engine.postMessage("stop");
    };
  }, [engineReady, fen, igraJeGotova]);

  function loadGameForTraining(gameId) {
    const record = savedGames.find((game) => game.id === gameId);
    if (!record) return;

    try {
      const loadedGame = new Chess();
      loadedGame.loadPgn(record.pgn);
      const moves = loadedGame.history({ verbose: true });

      setSelectedSavedGameId(gameId);
      setLines([
        {
          id: MAIN_LINE_ID,
          name: record.title || "Ucitana partija",
          moves,
        },
      ]);
      setActiveLineId(MAIN_LINE_ID);
      setCurrentPly(moves.length);
      setNextVariationNumber(1);
    } catch (error) {
      console.error("Ne mogu ucitati partiju u trening:", error);
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    try {
      const position = new Chess(fen);
      const move = position.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });

      if (move === null) return false;

      if (isAtLatestMove) {
        const updatedHistory = [...moveHistory, move];

        setLines((currentLines) =>
          currentLines.map((line) =>
            line.id === activeLineId
              ? { ...line, moves: updatedHistory }
              : line,
          ),
        );
        setCurrentPly(updatedHistory.length);
        return true;
      }

      const variationNumber = nextVariationNumber;
      const variationId = `variation-${variationNumber}`;
      const variationMoves = [...moveHistory.slice(0, currentPly), move];

      setLines((currentLines) => [
        ...currentLines,
        {
          id: variationId,
          name: `Varijanta ${variationNumber}`,
          moves: variationMoves,
        },
      ]);
      setNextVariationNumber((number) => number + 1);
      setActiveLineId(variationId);
      setCurrentPly(variationMoves.length);
      return true;
    } catch {
      return false;
    }
  }

  function selectLine(line) {
    setActiveLineId(line.id);
    setCurrentPly(line.moves.length);
  }

  function formatLinePreview(line) {
    if (line.moves.length === 0) {
      return "Pocetna pozicija";
    }

    return line.moves.map((move) => move.san).join(" ");
  }

  return (
    <div className="chessboard">
      <aside className="moves-panel">
        <h2>Povijest poteza</h2>

        <div className="training-games-panel">
          <h3>Ucitaj partiju</h3>
          {savedGames.length > 0 ? (
            <select
              value={selectedSavedGameId}
              onChange={(event) => loadGameForTraining(event.target.value)}
            >
              <option value="">Odaberi partiju za analizu</option>
              {savedGames.map((game, index) => (
                <option key={game.id} value={game.id}>
                  {index + 1}. {game.title}
                </option>
              ))}
            </select>
          ) : (
            <p>U Importu prvo ucitaj PGN partiju.</p>
          )}
        </div>

        <div className="move-navigation">
          <div className="move-buttons">
            <button
              type="button"
              onClick={() => setCurrentPly(0)}
              disabled={currentPly === 0}
            >
              {"<<"}
            </button>
            <button
              type="button"
              onClick={() => setCurrentPly((ply) => Math.max(0, ply - 1))}
              disabled={currentPly === 0}
            >
              {"<"}
            </button>
            <button
              type="button"
              onClick={() =>
                setCurrentPly((ply) =>
                  Math.min(activeLine.moves.length, ply + 1),
                )
              }
              disabled={currentPly === activeLine.moves.length}
            >
              {">"}
            </button>
            <button
              type="button"
              onClick={() => setCurrentPly(activeLine.moves.length)}
              disabled={currentPly === activeLine.moves.length}
            >
              {">>"}
            </button>
          </div>
          <span>{navigationLabel}</span>
        </div>

        {redoviPoteza.length > 0 ? (
          <table className="moves-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Bijeli</th>
                <th>Crni</th>
              </tr>
            </thead>
            <tbody>
              {redoviPoteza.map((red) => (
                <tr key={red.broj}>
                  <td>{red.broj}</td>
                  <td>
                    {red.bijeli && (
                      <button
                        type="button"
                        className={
                          currentPly === red.bijeli.ply ? "active-move" : ""
                        }
                        onClick={() => setCurrentPly(red.bijeli.ply)}
                      >
                        {red.bijeli.san}
                      </button>
                    )}
                  </td>
                  <td>
                    {red.crni && (
                      <button
                        type="button"
                        className={
                          currentPly === red.crni.ply ? "active-move" : ""
                        }
                        onClick={() => setCurrentPly(red.crni.ply)}
                      >
                        {red.crni.san}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-moves">Povuci prvi potez...</p>
        )}

        <div className="lines-panel">
          <h3>Linije partije</h3>
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              className={line.id === activeLineId ? "active-line" : ""}
              onClick={() => selectLine(line)}
            >
              <strong>{line.name}</strong>
              <span>{formatLinePreview(line)}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="board-panel">
        <div className="board-toolbar">
          <span>
            Pogled: {boardOrientation === "white" ? "bijeli" : "crni"}
          </span>
          <button
            type="button"
            onClick={() =>
              setBoardOrientation((orientation) =>
                orientation === "white" ? "black" : "white",
              )
            }
          >
            Okreni plocu
          </button>
        </div>

        <Chessboard
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={boardOrientation}
        />
        {!isAtLatestMove && (
          <p className="review-note">
            Pregledavas raniji potez. Ako sada povuces potez, spremit ce se kao
            nova alternativna linija.
          </p>
        )}
      </div>

      <aside className="engine-panel">
        <div className="engine-heading">
          <h2>Stockfish 18</h2>
          <span>{engineStatus}</span>
        </div>

        {analize.length > 0 ? (
          <ol className="engine-lines">
            {analize.map((analiza) => (
              <li key={analiza.id}>
                <div className="engine-line-main">
                  <strong>{analiza.bestMove}</strong>
                  <span>{analiza.score}</span>
                </div>
                <p>{analiza.pv}</p>
                <small>Dubina {analiza.depth}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-moves">Analiza ce se pojaviti nakon poteza.</p>
        )}
      </aside>
    </div>
  );
}
