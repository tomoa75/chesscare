import { useRef } from "react";
import {
  isAcceptedLegacyPgnFile,
  parsePgnCollection,
} from "../domain/pgnService";

/**
 * Komponenta za učitavanje PGN datoteke s hard diska.
 * @param {Object} props
 * @param {Function} props.onGameLoad - Callback funkcija koja prima novu, učitanu Chess instancu
 */
function PgnLoader({ onGameLoad, onGamesLoad, disabled = false }) {
  // Koristimo ref kako bismo sakrili ružni nativni input i aktivirali ga preko ljepšeg gumba
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Provjera ekstenzije (opcionalno, ali korisno)
    if (!isAcceptedLegacyPgnFile(file)) {
      alert("Molimo odaberite ispravnu .pgn datoteku.");
      return;
    }

    const reader = new FileReader();

    // Kada FileReader završi s čitanjem datoteke:
    reader.onload = (e) => {
      const pgnContent = e.target.result;

      try {
        // Kreiramo novu instancu šaha
        const loadedGames = parsePgnCollection(pgnContent);

        // Učitavamo PGN sadržaj u nju
        // Napomena: .loadPgn() u modernim verzijama chess.js vraća objekt ili baca grešku ako PGN ne valja
        // Vraćamo novu igru natrag roditeljskoj komponenti
        if (onGamesLoad) {
          onGamesLoad(loadedGames, file.name);
        } else {
          onGameLoad(loadedGames[0]);
        }

        // Resetiramo input kako bi se ista datoteka mogla ponovno učitati ako zatreba
        event.target.value = "";
      } catch (error) {
        console.error("Greška pri parsiranju PGN-a:", error);
        alert("Došlo je do pogreške! Datoteka nije u ispravnom PGN formatu.");
      }
    };

    // Pokretanje čitanja datoteke kao običnog teksta
    reader.readAsText(file);
  };

  const triggerFileSelect = () => {
    if (disabled) return;
    fileInputRef.current.click();
  };

  return (
    <div style={{ display: "inline-block" }}>
      {/* Skriveni pravi input element */}
      <input
        type="file"
        accept=".pgn"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Naš lijepo stilizirani gumb koji glumi input */}
      <button
        type="button"
        onClick={triggerFileSelect}
        disabled={disabled}
        style={{
          padding: "10px 16px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontWeight: "bold",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        }}
      >
        Učitaj PGN datoteku
      </button>
    </div>
  );
}

export default PgnLoader;
