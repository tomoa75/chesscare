export default function Potez(moveInput) {
  // 1. Osnovno čišćenje razmaka
  let move = moveInput.trim();
  if (move.length === 0) return move;

  // 2. Poseban slučaj: Ako je unos dug točno 2 ili 3 znaka i završava brojem (npr. "d4", "D4", "e4", "Nf3")
  // Moramo paziti da "D4" ili "C3" ne pretvorimo u figuru, nego u polje (mala slova).
  if (move.length === 2 && /^[a-hA-H][1-8]$/.test(move)) {
    return move.toLowerCase();
  }
  // Slučaj za npr. "exd5" ili "d8=Q" rješavamo u nastavku, ali ako je samo polje (npr. "d4"), odmah ga vraćamo malim slovima.

  // Rastavljamo prvi znak (potencijalna figura) i ostatak poteza
  let firstChar = move.charAt(0);
  let restOfMove = move.slice(1);

  // 3. Mapiranje hrvatskih i malih engleskih figura u ispravne engleske SAN oznake
  const figuraMap = {
    // Hrvatske oznake
    K: "K",
    k: "K", // Kralj
    D: "Q",
    d: "Q", // Dama
    T: "R",
    t: "R", // Top
    L: "B",
    l: "B", // Lovac
    S: "N",
    s: "N", // Skakač
    // Engleske oznake (za slučaj da unesu mala slova npr. "nf3")
    n: "N",
    b: "B",
    r: "R",
    q: "Q",
  };

  if (figuraMap[firstChar]) {
    // Ako je prvi znak prepoznat kao figura, zamijeni ga i spoji s ostatkom (ostatak polja mora biti malim slovima)
    return figuraMap[firstChar] + restOfMove.toLowerCase();
  }

  // 4. Ako nije prepoznata figura na početku, pretpostavljamo da je potez pješakom (npr. "e4", "exd5")
  // Sve ide u mala slova jer pješaci nemaju veliku oznaku
  return move.toLowerCase();
}
