export default function Potez(moveInput) {
  // 1. Osnovno čišćenje razmaka
  let move = moveInput.trim();
  if (move.length === 0) return move;

  // 2. SPECIJALAN SLUČAJ ZA PJEŠAKE (Uzimanje: npr. dxc6, exd5, bxc3, axb6)
  // Ako je drugi znak 'x', a prvi znak je linija (a-h), to je sigurno pješak koji uzima.
  // Ovo rješava problem da se 'bxc3' ne pomiješa s Lovcem (b).
  if (/^[a-h]x/i.test(move)) {
    return move.toLowerCase();
  }

  // 3. SPECIJALAN SLUČAJ ZA PJEŠAKE (Obično pomicanje: npr. e4, d4, a6)
  // Ako je unos dug točno 2 znaka (ili 3 ako je šah npr. e4+), a počinje slovom a-h i završava brojem
  if (/^[a-h][1-8]/i.test(move)) {
    return move.toLowerCase();
  }

  // Rastavljamo prvi znak (figura) i ostatak poteza
  let firstChar = move.charAt(0);
  let restOfMove = move.slice(1);

  // 4. Potpuna mapa figura (uključuje VELIKA i mala slova za HR i ENG)
  const figuraMap = {
    // Hrvatske oznake (Velika i mala slova)
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

    // Engleske oznake (Ako netko unese engleska slova)
    // Napomena: 'b' za engleskog lovca (Bishop) i 'd' za queen će sada raditi
    // jer smo u koracima 2 i 3 precizno izolirali pješake.
    Q: "Q",
    q: "Q",
    R: "R",
    r: "R",
    B: "B",
    b: "B",
    N: "N",
    n: "N",
  };

  if (figuraMap[firstChar]) {
    return figuraMap[firstChar] + restOfMove.toLowerCase();
  }

  return move.toLowerCase();
}
