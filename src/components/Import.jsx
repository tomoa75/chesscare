import { useState, useMemo } from "react";
import { Chess } from "chess.js";
import PgnSaver from "./PgnSaver";
import PgnLoader from "./PgnLoader";
import Potez from "../assets/Potez";
import "../import.css"; // Uvezi CSS datoteku za dodatne stilove

export default function ChessGame() {
  const [chess, setChess] = useState(new Chess());
  const [moveInput, setMoveInput] = useState("");
  const [message, setMessage] = useState("");
  const [pgn, setPgn] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [eventName, setEventName] = useState("");

  // Prati koji potez trenutno gledamo (-1 znači početna pozicija)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);

  // Dohvaćamo povijest glavne partije
  const history = chess.history();

  // OPTIMIZACIJA: displayChess se rekreira samo kada se promijeni partija ili indeks poteza
  const displayChess = useMemo(() => {
    const tempChess = new Chess();
    for (let i = 0; i <= currentMoveIndex; i++) {
      tempChess.move(history[i]);
    }
    return tempChess;
  }, [chess, currentMoveIndex, history]);

  const handleGameLoaded = (loadedGame) => {
    setChess(loadedGame);
    setPgn(loadedGame.pgn());

    const headers = loadedGame.header();
    setWhitePlayer(headers["White"] || "");
    setBlackPlayer(headers["Black"] || "");
    setEventName(headers["Event"] || "");

    setCurrentMoveIndex(loadedGame.history().length - 1);
    setMessage("📂 Partija uspješno učitana iz datoteke!");
  };

  function handleMove() {
    if (!moveInput.trim()) return;

    // Ako igramo novi potez dok smo u prošlosti, režemo sve nakon toga
    const updatedChess = new Chess();
    const historyUpToCurrent = history.slice(0, currentMoveIndex + 1);

    for (const m of historyUpToCurrent) {
      updatedChess.move(m);
    }

    updatedChess.header(
      "White",
      whitePlayer || "Bijeli",
      "Black",
      blackPlayer || "Crni",
      "Event",
      eventName || "Turnir",
    );

    try {
      const move = updatedChess.move(Potez(moveInput));

      setChess(updatedChess);
      setPgn(updatedChess.pgn());
      setCurrentMoveIndex(updatedChess.history().length - 1);
      setMessage(`✅ Odigrano: ${move.san}`);
      setMoveInput("");
    } catch {
      setMessage("❌ Nelegalan potez");
    }
  }

  function resetGame() {
    setChess(new Chess());
    setPgn("");
    setCurrentMoveIndex(-1);
    setMessage("♻️ Partija resetirana");
  }

  // Funkcije za navigaciju
  const jumpToStart = () => setCurrentMoveIndex(-1);
  const stepBackward = () =>
    setCurrentMoveIndex((prev) => Math.max(-1, prev - 1));
  const stepForward = () =>
    setCurrentMoveIndex((prev) => Math.min(history.length - 1, prev + 1));
  const jumpToEnd = () => setCurrentMoveIndex(history.length - 1);

  return (
    <div className="chess-container">
      <h1>♟️ Chess.js React Demo</h1>

      <div className="chess-board">
        <pre>{displayChess.ascii()}</pre>
      </div>

      {/* Kontrole za navigaciju */}
      <div className="navigation-controls">
        <button
          onClick={jumpToStart}
          disabled={currentMoveIndex === -1}
          className="nav-button"
        >
          ⏮
        </button>
        <button
          onClick={stepBackward}
          disabled={currentMoveIndex === -1}
          className="nav-button"
        >
          ◀
        </button>
        <span style={{ alignSelf: "center", fontWeight: "bold" }}>
          {currentMoveIndex + 1} / {history.length}
        </span>
        <button
          onClick={stepForward}
          disabled={currentMoveIndex === history.length - 1}
          className="nav-button"
        >
          ▶
        </button>
        <button
          onClick={jumpToEnd}
          disabled={currentMoveIndex === history.length - 1}
          className="nav-button"
        >
          ⏭
        </button>
      </div>

      <div className="chess-controls">
        <input
          type="text"
          placeholder="unesi ime turnira"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          className="chess-input"
        />
        <input
          type="text"
          placeholder="unesi ime bijelog igrača"
          value={whitePlayer}
          onChange={(e) => setWhitePlayer(e.target.value)}
          className="chess-input"
        />
        <input
          type="text"
          placeholder="unesi ime crnog igrača"
          value={blackPlayer}
          onChange={(e) => setBlackPlayer(e.target.value)}
          className="chess-input"
        />
        <input
          type="text"
          placeholder="Unesi potez (npr. e4 ili Nf3)"
          value={moveInput}
          onChange={(e) => setMoveInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleMove()}
          className="chess-input"
        />

        <button onClick={handleMove} className="chess-button">
          Odigraj
        </button>
        <button onClick={resetGame} className="chess-reset-button">
          Reset
        </button>
      </div>

      {/* POBOLJŠANA LISTA POTEZA: Pojedinačni potezi se mogu kliknuti i označeni su ako su aktivni */}
      <div>
        <h2>Potezi</h2>
        <div
          className="moves-list"
          style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}
        >
          {history.reduce((rows, move, index, moves) => {
            if (index % 2 === 0) {
              const whiteIdx = index;
              const blackIdx = index + 1;
              const hasBlackMove = moves[blackIdx] !== undefined;

              rows.push(
                <span key={index} style={{ padding: "2px 5px" }}>
                  <strong>{Math.floor(index / 2) + 1}.</strong>{" "}
                  <span
                    onClick={() => setCurrentMoveIndex(whiteIdx)}
                    style={{
                      cursor: "pointer",
                      backgroundColor:
                        currentMoveIndex === whiteIdx
                          ? "#ffd700"
                          : "transparent",
                      padding: "0 2px",
                    }}
                  >
                    {move}
                  </span>{" "}
                  {hasBlackMove && (
                    <span
                      onClick={() => setCurrentMoveIndex(blackIdx)}
                      style={{
                        cursor: "pointer",
                        backgroundColor:
                          currentMoveIndex === blackIdx
                            ? "#ffd700"
                            : "transparent",
                        padding: "0 2px",
                      }}
                    >
                      {moves[blackIdx]}
                    </span>
                  )}
                </span>,
              );
            }
            return rows;
          }, [])}
        </div>
      </div>

      {message && <p>{message}</p>}

      <div className="chess-info">
        <h1>
          {eventName || "Turnir"}
          {whitePlayer && ` - ${whitePlayer}`}
          {blackPlayer && ` - ${blackPlayer}`}
        </h1>
        <h2>PGN</h2>
        <textarea value={pgn} readOnly rows={10} className="chess-textarea" />
      </div>

      <div className="chess-info">
        <h2>FEN</h2>
        <p>
          Trenutna pozicija (FEN): <br />
          <code>{displayChess.fen()}</code>
        </p>
      </div>

      <div className="chess-info">
        <h2>Status</h2>
        <ul>
          <li>Na potezu: {displayChess.turn() === "w" ? "Bijeli" : "Crni"}</li>
          <li>Šah: {displayChess.isCheck() ? "DA" : "NE"}</li>
          <li>Mat: {displayChess.isCheckmate() ? "DA" : "NE"}</li>
          <li>Pat: {displayChess.isStalemate() ? "DA" : "NE"}</li>
          <li>Kraj igre: {displayChess.isGameOver() ? "DA" : "NE"}</li>
        </ul>
      </div>

      <div className="chess-controls" style={{ marginTop: "20px" }}>
        <PgnLoader onGameLoad={handleGameLoaded} />
        <PgnSaver
          chessInstance={chess}
          fileName={`${eventName || "partija"}.pgn`}
        />
      </div>
    </div>
  );
}
