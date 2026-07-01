import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import PgnSaver from "./PgnSaver";
import PgnLoader from "./PgnLoader";
import Potez from "../assets/Potez";
import { loadSavedGames, saveSavedGames } from "../gameStorage";

import "../import.css"; // Uvezi CSS datoteku za dodatne stilove

const GAME_DRAFT_KEY = "chesscare-current-game-draft";

function loadGameDraft() {
  try {
    const savedDraft = window.sessionStorage.getItem(GAME_DRAFT_KEY);
    return savedDraft ? JSON.parse(savedDraft) : null;
  } catch {
    return null;
  }
}

function createChessFromDraft(draft) {
  const restoredChess = new Chess();

  if (!draft?.gamePgn) return restoredChess;

  try {
    restoredChess.loadPgn(draft.gamePgn);
    return restoredChess;
  } catch {
    return new Chess();
  }
}

function saveGameDraft(draft) {
  try {
    window.sessionStorage.setItem(GAME_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Partija i dalje radi ako preglednik blokira sessionStorage.
  }
}

function createGameRecord(game, index) {
  const headers = game.header();
  const event = headers.Event || "Partija";
  const white = headers.White || "Bijeli";
  const black = headers.Black || "Crni";

  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    title: `${event}: ${white} - ${black}`,
    pgn: game.pgn(),
  };
}

export default function ChessGame() {
  const [initialDraft] = useState(loadGameDraft);
  const [chess, setChess] = useState(() => createChessFromDraft(initialDraft));
  const [moveInput, setMoveInput] = useState(initialDraft?.moveInput || "");
  const [message, setMessage] = useState("");
  const [pgn, setPgn] = useState(
    initialDraft?.displayPgn || initialDraft?.gamePgn || "",
  );
  const [whitePlayer, setWhitePlayer] = useState(
    initialDraft?.whitePlayer || "",
  );
  const [blackPlayer, setBlackPlayer] = useState(
    initialDraft?.blackPlayer || "",
  );
  const [eventName, setEventName] = useState(initialDraft?.eventName || "");
  const [boardOrientation, setBoardOrientation] = useState(
    initialDraft?.boardOrientation === "black" ? "black" : "white",
  );
  const [savedGames, setSavedGames] = useState(() => loadSavedGames());
  const [selectedSavedGameId, setSelectedSavedGameId] = useState(
    initialDraft?.selectedSavedGameId || "",
  );

  // Prati koji potez trenutno gledamo (-1 znači početna pozicija)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(
    Number.isInteger(initialDraft?.currentMoveIndex)
      ? initialDraft.currentMoveIndex
      : -1,
  );

  // Dohvaćamo povijest glavne partije
  const history = chess.history();
  const gamesPgn = useMemo(
    () => savedGames.map((game) => game.pgn).join("\n\n"),
    [savedGames],
  );

  useEffect(() => {
    saveSavedGames(savedGames);
  }, [savedGames]);

  useEffect(() => {
    saveGameDraft({
      gamePgn: chess.pgn(),
      displayPgn: pgn,
      moveInput,
      whitePlayer,
      blackPlayer,
      eventName,
      boardOrientation,
      currentMoveIndex,
      selectedSavedGameId,
    });
  }, [
    chess,
    pgn,
    moveInput,
    whitePlayer,
    blackPlayer,
    eventName,
    boardOrientation,
    currentMoveIndex,
    selectedSavedGameId,
  ]);

  // OPTIMIZACIJA: displayChess se rekreira samo kada se promijeni partija ili indeks poteza
  const displayChess = useMemo(() => {
    const tempChess = new Chess();
    for (let i = 0; i <= currentMoveIndex; i++) {
      tempChess.move(history[i]);
    }
    return tempChess;
  }, [currentMoveIndex, history]);

  const getCurrentGameWithHeaders = () => {
    const updatedChess = new Chess();

    for (const move of history) {
      updatedChess.move(move);
    }

    for (const [name, value] of Object.entries(chess.header())) {
      updatedChess.header(name, value);
    }

    updatedChess.header(
      "White",
      whitePlayer || "Bijeli",
      "Black",
      blackPlayer || "Crni",
      "Event",
      eventName || "Turnir",
    );

    return updatedChess;
  };

  const handleGameLoaded = (loadedGame, savedGameId = "") => {
    setChess(loadedGame);
    setPgn(loadedGame.pgn());
    setSelectedSavedGameId(savedGameId);

    const headers = loadedGame.header();
    setWhitePlayer(headers["White"] || "");
    setBlackPlayer(headers["Black"] || "");
    setEventName(headers["Event"] || "");

    setCurrentMoveIndex(loadedGame.history().length - 1);
    setMessage("📂 Partija uspješno učitana iz datoteke!");
  };
  const handleGamesLoaded = (loadedGames) => {
    const records = loadedGames.map((game, index) =>
      createGameRecord(game, index),
    );

    setSavedGames(records);
    handleGameLoaded(loadedGames[0], records[0]?.id || "");
    setMessage(`Ucitano partija iz datoteke: ${records.length}`);
  };

  const addCurrentGameToCollection = () => {
    const currentGame = getCurrentGameWithHeaders();

    if (currentGame.history().length === 0) {
      setMessage("Nema poteza za dodati u datoteku.");
      return;
    }

    const record = createGameRecord(currentGame, savedGames.length);
    setSavedGames((games) => [...games, record]);
    setSelectedSavedGameId(record.id);
    setPgn(currentGame.pgn());
    setMessage(`Partija dodana u zajednicku datoteku (${savedGames.length + 1}).`);
  };

  const saveChangesToSelectedGame = () => {
    if (!selectedSavedGameId) {
      setMessage("Najprije odaberi partiju koju zelis azurirati.");
      return;
    }

    const updatedGame = getCurrentGameWithHeaders();
    const headers = updatedGame.header();
    const title = `${headers.Event || "Partija"}: ${headers.White || "Bijeli"} - ${headers.Black || "Crni"}`;
    const updatedPgn = updatedGame.pgn();

    setSavedGames((games) =>
      games.map((game) =>
        game.id === selectedSavedGameId
          ? { ...game, title, pgn: updatedPgn }
          : game,
      ),
    );
    setChess(updatedGame);
    setPgn(updatedPgn);
    setMessage("Promjene igraca i turnira spremljene su u partiju.");
  };

  const loadSavedGame = (gameId) => {
    const record = savedGames.find((game) => game.id === gameId);
    if (!record) return;

    const loadedGame = new Chess();
    loadedGame.loadPgn(record.pgn);
    handleGameLoaded(loadedGame, gameId);
    setMessage(`Otvorena partija: ${record.title}`);
  };

  const removeSavedGame = (gameId) => {
    setSavedGames((games) => games.filter((game) => game.id !== gameId));
    if (selectedSavedGameId === gameId) {
      setSelectedSavedGameId("");
    }
  };

  function onDrop(sourceSquare, targetSquare) {
    // radimo novu privremenu instancu iz trenutne pozicije (bitno zbog history sustava)
    const tempChess = new Chess(displayChess.fen());

    const move = tempChess.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    });

    if (!move) return false;

    // Kreiramo novu “glavnu” igru iz trenutne povijesti + novi potez
    const updatedChess = new Chess();

    // prvo reproduciramo poteze do trenutnog indeksa
    const historyUpToCurrent = chess.history().slice(0, currentMoveIndex + 1);

    for (const m of historyUpToCurrent) {
      updatedChess.move(m);
    }

    // dodajemo novi potez
    updatedChess.move(move.san);

    updatedChess.header(
      "White",
      whitePlayer || "Bijeli",
      "Black",
      blackPlayer || "Crni",
      "Event",
      eventName || "Turnir",
    );

    setChess(updatedChess);
    setPgn(updatedChess.pgn());
    setCurrentMoveIndex(updatedChess.history().length - 1);
    setMessage(`Odigrano: ${move.san}`);

    return true;
  }

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

  function deleteSelectedMove() {
    if (currentMoveIndex < 0) return;

    const deletedMove = history[currentMoveIndex];
    const updatedChess = new Chess();

    for (const move of history.slice(0, currentMoveIndex)) {
      updatedChess.move(move);
    }

    updatedChess.header(
      "White",
      whitePlayer || "Bijeli",
      "Black",
      blackPlayer || "Crni",
      "Event",
      eventName || "Turnir",
    );

    setChess(updatedChess);
    setPgn(updatedChess.pgn());
    setCurrentMoveIndex(currentMoveIndex - 1);
    setMessage(`Obrisan potez ${deletedMove} i svi potezi nakon njega.`);
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
      <h1>Chess.js React Demo</h1>

      <div className="chess-board">
        <Chessboard
          position={displayChess.fen()}
          onPieceDrop={onDrop}
          boardOrientation={boardOrientation}
        />
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
        <button
          onClick={() =>
            setBoardOrientation((prev) =>
              prev === "white" ? "black" : "white",
            )
          }
          className="nav-button"
        >
          🔄OKRENI PLOČU
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
        <button
          type="button"
          onClick={deleteSelectedMove}
          disabled={currentMoveIndex < 0}
          className="chess-delete-move-button"
          title="Briše označeni potez i sve poteze nakon njega"
        >
          Obriši označeni potez
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

      <div className="chess-info">
        <h2>Partije u datoteci</h2>
        <p>Broj partija: {savedGames.length}</p>

        {savedGames.length > 0 && (
          <>
            <select
              value={selectedSavedGameId}
              onChange={(event) => loadSavedGame(event.target.value)}
              className="chess-input"
              style={{ width: "100%", maxWidth: "500px" }}
            >
              {savedGames.map((game, index) => (
                <option key={game.id} value={game.id}>
                  {index + 1}. {game.title}
                </option>
              ))}
            </select>

            <ul className="saved-games-list">
              {savedGames.map((game, index) => (
                <li key={game.id}>
                  <button
                    type="button"
                    onClick={() => loadSavedGame(game.id)}
                    className="saved-game-button"
                  >
                    {index + 1}. {game.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSavedGame(game.id)}
                    className="saved-game-remove"
                  >
                    Ukloni
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="chess-controls" style={{ marginTop: "20px" }}>
        <PgnLoader
          onGameLoad={handleGameLoaded}
          onGamesLoad={handleGamesLoaded}
        />
        <button onClick={addCurrentGameToCollection} className="chess-button">
          Dodaj partiju u datoteku
        </button>
        <button
          type="button"
          onClick={saveChangesToSelectedGame}
          disabled={!selectedSavedGameId}
          className="chess-button"
          title="Ažurira odabranu partiju novim imenima i nazivom turnira"
        >
          Spremi promjene u odabranu partiju
        </button>
        <PgnSaver
          pgnText={getCurrentGameWithHeaders().pgn()}
          fileName={`${eventName || "partija"}.pgn`}
          buttonText="Spremi trenutnu partiju"
        />
        {savedGames.length > 0 && (
          <PgnSaver
            pgnText={gamesPgn}
            fileName={`${eventName || "partije"}.pgn`}
            buttonText="Spremi sve partije"
          />
        )}
      </div>
    </div>
  );
}
