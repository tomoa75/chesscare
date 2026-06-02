import { useState } from "react";
import { Chess } from "chess.js";
import PgnSaver from "./PgnSaver";
import PgnLoader from "./PgnLoader";

export default function ChessGame() {
  const [chess, setChess] = useState(new Chess());
  const [moveInput, setMoveInput] = useState("");
  const [message, setMessage] = useState("");
  const [pgn, setPgn] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [eventName, setEventName] = useState("");

  // NOVI STATE: Prati koji potez trenutno gledamo (-1 znači početna pozicija)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);

  // Pomoćna funkcija koja nam daje listu svih odigranih poteza do sada
  const history = chess.history();

  // Kreiramo privremenu ploču koja prikazuje poziciju na kojoj se korisnik trenutno nalazi u povijesti
  const displayChess = new Chess();
  for (let i = 0; i <= currentMoveIndex; i++) {
    displayChess.move(history[i]);
  }

  const handleGameLoaded = (loadedGame) => {
    setChess(loadedGame);
    setPgn(loadedGame.pgn());

    const headers = loadedGame.header();
    setWhitePlayer(headers["White"] || "");
    setBlackPlayer(headers["Black"] || "");
    setEventName(headers["Event"] || "");

    // Kada se učita nova partija, skoči na njezin kraj
    setCurrentMoveIndex(loadedGame.history().length - 1);
    setMessage("📂 Partija uspješno učitana iz datoteke!");
  };

  function handleMove() {
    if (!moveInput.trim()) return;

    // Ako korisnik odigra potez dok gleda neku staru poziciju,
    // kreiramo novu partiju od te pozicije (odsijecamo buduće poteze)
    const updatedChess = new Chess();
    const historyUpToCurrent = chess.history().slice(0, currentMoveIndex + 1);

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
      const move = updatedChess.move(moveInput.trim());

      setChess(updatedChess);
      setPgn(updatedChess.pgn());

      // Budući da smo odigrali novi potez, indeks se pomiče na taj novi kraj
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
    setCurrentMoveIndex(-1); // Resetiramo indeks na početak
    setMessage("♻️ Partija resetirana");
  }

  // FUNKCIJE ZA NAVIGACIJU KROZ POTEZE
  const jumpToStart = () => setCurrentMoveIndex(-1);
  const stepBackward = () =>
    setCurrentMoveIndex((prev) => Math.max(-1, prev - 1));
  const stepForward = () =>
    setCurrentMoveIndex((prev) => Math.min(history.length - 1, prev + 1));
  const jumpToEnd = () => setCurrentMoveIndex(history.length - 1);

  return (
    <div style={styles.container}>
      <h1>♟️ Chess.js React Demo</h1>

      {/* VAŽNO: Sada renderiramo 'displayChess.ascii()' umjesto 'chess.ascii()' */}
      <div style={styles.board}>
        <pre>{displayChess.ascii()}</pre>
      </div>

      {/* NOVI DIZJN: Gumbi za listanje kroz poteze (ispod ploče) */}
      <div
        style={{
          ...styles.controls,
          justifyContent: "center",
          marginBottom: "10px",
        }}
      >
        <button
          onClick={jumpToStart}
          disabled={currentMoveIndex === -1}
          style={styles.navButton}
        >
          ⏮
        </button>
        <button
          onClick={stepBackward}
          disabled={currentMoveIndex === -1}
          style={styles.navButton}
        >
          ◀
        </button>
        <span style={{ alignSelf: "center", fontWeight: "bold" }}>
          {currentMoveIndex + 1} / {history.length}
        </span>
        <button
          onClick={stepForward}
          disabled={currentMoveIndex === history.length - 1}
          style={styles.navButton}
        >
          ▶
        </button>
        <button
          onClick={jumpToEnd}
          disabled={currentMoveIndex === history.length - 1}
          style={styles.navButton}
        >
          ⏭
        </button>
      </div>

      <div style={styles.controls}>
        <input
          type="text"
          placeholder="unesi ime turnira"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          style={styles.input}
        />
        <input
          type="text"
          placeholder="unesi ime bijelog igrača"
          value={whitePlayer}
          onChange={(e) => setWhitePlayer(e.target.value)}
          style={styles.input}
        />
        <input
          type="text"
          placeholder="unesi ime crnog igrača"
          value={blackPlayer}
          onChange={(e) => setBlackPlayer(e.target.value)}
          style={styles.input}
        />
        <input
          type="text"
          placeholder="Unesi potez (npr. e4 ili Nf3)"
          value={moveInput}
          onChange={(e) => setMoveInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleMove();
            }
          }}
          style={styles.input}
        />

        <button onClick={handleMove} style={styles.button}>
          Odigraj
        </button>

        <button onClick={resetGame} style={styles.resetButton}>
          Reset
        </button>
      </div>

      {message && <p>{message}</p>}

      <div style={styles.info}>
        <h1>
          {eventName || "Turnir"}
          {whitePlayer && ` - ${whitePlayer}`}
          {blackPlayer && ` - ${blackPlayer}`}
        </h1>
        <h2>PGN</h2>
        <textarea value={pgn} readOnly rows={10} style={styles.textarea} />
      </div>

      <div style={styles.info}>
        <h2>FEN</h2>
        <p>
          Trenutna pozicija (FEN): <br />
          <code>{displayChess.fen()}</code>
        </p>
      </div>

      <div style={styles.info}>
        <h2>Status</h2>
        <ul>
          <li>Na potezu: {displayChess.turn() === "w" ? "Bijeli" : "Crni"}</li>
          <li>Šah: {displayChess.isCheck() ? "DA" : "NE"}</li>
          <li>Mat: {displayChess.isCheckmate() ? "DA" : "NE"}</li>
          <li>Pat: {displayChess.isStalemate() ? "DA" : "NE"}</li>
          <li>Kraj igre: {displayChess.isGameOver() ? "DA" : "NE"}</li>
        </ul>
      </div>

      <div style={{ ...styles.controls, marginTop: "20px" }}>
        <PgnLoader onGameLoad={handleGameLoaded} />
        <PgnSaver
          chessInstance={chess}
          fileName={`${eventName || "partija"}.pgn`}
        />
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "700px",
    margin: "40px auto",
    padding: "20px",
    fontFamily: "Arial",
  },
  board: {
    background: "#111",
    color: "#0f0",
    padding: "20px",
    borderRadius: "10px",
    overflowX: "auto",
  },
  controls: {
    display: "flex",
    gap: "10px",
    marginTop: "20px",
  },
  input: {
    flex: 1,
    padding: "10px",
    fontSize: "16px",
  },
  button: {
    padding: "10px 20px",
    cursor: "pointer",
  },
  resetButton: {
    padding: "10px 20px",
    background: "#d33",
    color: "#fff",
    border: "none",
    cursor: "pointer",
  },
  // NOVI STIL za navigacijske gumbe
  navButton: {
    padding: "10px 15px",
    fontSize: "18px",
    cursor: "pointer",
    background: "#f0f0f0",
    border: "1px solid #ccc",
    borderRadius: "4px",
  },
  info: {
    marginTop: "20px",
  },
  textarea: {
    width: "100%",
    padding: "10px",
    fontFamily: "monospace",
  },
};
