/**
 * Komponenta za spremanje PGN datoteke na hard disk.
 * @param {Object} props
 * @param {Object} props.chessInstance - Instanca 'Chess' klase iz chess.js biblioteke (npr. game ili chess)
 * @param {string} [props.fileName] - Neobavezno ime datoteke (default je 'partija.pgn')
 */
function PgnSaver({
  chessInstance,
  pgnText,
  fileName = "partija.pgn",
  buttonText = "Spremi PGN datoteku",
  askForFileName = false,
  onSave,
}) {
  const handleSavePgn = () => {
    // Provjera postoji li instanca i metoda kako bi se izbjegao crash
    if (
      typeof pgnText !== "string" &&
      (!chessInstance || typeof chessInstance.pgn !== "function")
    ) {
      console.error("PgnSaver: Proslijeđena instanca chess.js nije ispravna.");
      alert("Pogreška: Nemoguće generirati PGN.");
      return;
    }

    // 1. chess.js generira kompletan PGN string (uključujući sve tagove i poteze)
    const pgnString = typeof pgnText === "string" ? pgnText : chessInstance.pgn();

    if (!pgnString || pgnString.trim() === "") {
      alert("Nema partija za spremanje.");
      return;
    }

    // 2. Pretvaranje stringa u Blob s odgovarajućim MIME tipom
    let downloadFileName = fileName;

    if (askForFileName) {
      const enteredFileName = window.prompt(
        "Unesi ime PGN datoteke:",
        fileName.replace(/\.pgn$/i, ""),
      );

      if (enteredFileName === null) return;

      const cleanedFileName = enteredFileName.trim();
      if (!cleanedFileName) {
        alert("Ime datoteke ne može biti prazno.");
        return;
      }

      downloadFileName = cleanedFileName;
    }

    const blob = new Blob([pgnString], {
      type: "application/x-chess-pgn;charset=utf-8",
    });

    // 3. Kreiranje privremenog URL-a u memoriji preglednika
    const url = URL.createObjectURL(blob);

    // 4. Kreiranje nevidljivog 'a' elementa koji glumi download gumb
    const link = document.createElement("a");
    link.href = url;
    const finalFileName = downloadFileName.toLowerCase().endsWith(".pgn")
      ? downloadFileName
      : `${downloadFileName}.pgn`;
    link.download = finalFileName;

    // 5. Dodavanje u DOM, okidanje klika i micanje iz DOM-a
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 6. Čišćenje memorije
    URL.revokeObjectURL(url);
    onSave?.(finalFileName);
  };

  return (
    <button
      onClick={handleSavePgn}
      style={{
        padding: "10px 16px",
        backgroundColor: "#28a745",
        color: "white",
        border: "none",
        borderRadius: "4px",
        fontWeight: "bold",
        cursor: "pointer",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      }}
    >
      {buttonText}
    </button>
  );
}

export default PgnSaver;
