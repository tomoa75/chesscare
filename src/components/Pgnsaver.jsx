/**
 * Komponenta za spremanje PGN datoteke na hard disk.
 * @param {Object} props
 * @param {Object} props.chessInstance - Instanca 'Chess' klase iz chess.js biblioteke (npr. game ili chess)
 * @param {string} [props.fileName] - Neobavezno ime datoteke (default je 'partija.pgn')
 */
function PgnSaver({ chessInstance, fileName = "partija.pgn" }) {
  const handleSavePgn = () => {
    // Provjera postoji li instanca i metoda kako bi se izbjegao crash
    if (!chessInstance || typeof chessInstance.pgn !== "function") {
      console.error("PgnSaver: Proslijeđena instanca chess.js nije ispravna.");
      alert("Pogreška: Nemoguće generirati PGN.");
      return;
    }

    // 1. chess.js generira kompletan PGN string (uključujući sve tagove i poteze)
    const pgnString = chessInstance.pgn();

    if (!pgnString || pgnString.trim() === "") {
      alert("Partija je prazna. Nema poteza za spremanje.");
      return;
    }

    // 2. Pretvaranje stringa u Blob s odgovarajućim MIME tipom
    const blob = new Blob([pgnString], {
      type: "application/x-chess-pgn;charset=utf-8",
    });

    // 3. Kreiranje privremenog URL-a u memoriji preglednika
    const url = URL.createObjectURL(blob);

    // 4. Kreiranje nevidljivog 'a' elementa koji glumi download gumb
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.endsWith(".pgn") ? fileName : `${fileName}.pgn`;

    // 5. Dodavanje u DOM, okidanje klika i micanje iz DOM-a
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 6. Čišćenje memorije
    URL.revokeObjectURL(url);
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
      Spremi PGN datoteku
    </button>
  );
}

export default PgnSaver;
