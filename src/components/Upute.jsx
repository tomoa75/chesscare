import { Link } from "react-router-dom";
import "../upute.css";

const APP_AREAS = [
  {
    path: "/import",
    title: "Import",
    description:
      "Učitaj PGN datoteku ili ručno unesi poteze i podatke o partiji.",
  },
  {
    path: "/library",
    title: "Biblioteka",
    description:
      "Pregledaj, pretraži, otvori, izvezi ili sigurno obriši spremljene partije.",
  },
  {
    path: "/position-analysis",
    title: "Analiza pozicije",
    description:
      "Prolazi kroz poteze na ploči, isprobaj varijante i prati Stockfish prijedloge.",
  },
  {
    path: "/analysis-jobs",
    title: "Analiza",
    description:
      "Pokreni cjelovitu Stockfish analizu jedne ili više partija i pripremi rezultate igrača.",
  },
  {
    path: "/player-identities",
    title: "Identiteti",
    description:
      "Potvrdi različite zapise istog imena ili spoji profile koji pripadaju istom igraču.",
  },
  {
    path: "/players",
    title: "Igrači",
    description:
      "Pogledaj preciznost, klasifikaciju poteza i glavne prioritete za napredak.",
  },
  {
    path: "/training-plan",
    title: "Plan treninga",
    description:
      "Pretvori analizirane pogreške odabranog igrača u zadatke za vježbanje.",
  },
  {
    path: "/training-session",
    title: "Trening",
    description:
      "Rješavaj dospjele pozicije i označi koliko ti je zadatak bio težak.",
  },
  {
    path: "/training-progress",
    title: "Napredak",
    description:
      "Prati uspješnost, raspored ponavljanja, slabosti i posljednje pokušaje.",
  },
];

export default function Upute() {
  return (
    <main className="guide-page">
      <header className="guide-hero">
        <span className="guide-eyebrow">Vodič kroz aplikaciju</span>
        <h1>Kako koristiti Chesscare</h1>
        <p>
          Chesscare povezuje tvoje PGN partije, Stockfish analizu i trening u
          jedan tijek rada. Najbolji rezultat dobivaš kada korake prolaziš
          redom: partija, analiza, profil igrača i trening.
        </p>
        <Link className="guide-start-link" to="/import">
          Započni u Importu
        </Link>
      </header>

      <section className="guide-section" aria-labelledby="quick-start-title">
        <div className="guide-section-heading">
          <span>Najbrži početak</span>
          <h2 id="quick-start-title">Od PGN-a do treninga u šest koraka</h2>
        </div>
        <ol className="guide-steps">
          <li>
            <strong>Dodaj partiju</strong>
            <span>Učitaj PGN ili ručno odigraj poteze u Importu.</span>
          </li>
          <li>
            <strong>Provjeri biblioteku</strong>
            <span>Potvrdi da su igrači, turnir i rezultat ispravni.</span>
          </li>
          <li>
            <strong>Pokreni analizu</strong>
            <span>Pripremi posao, potvrdi ga i pokreni Stockfish.</span>
          </li>
          <li>
            <strong>Spremi rezultate igrača</strong>
            <span>Odaberi dovršenu analizu i odgovarajući profil.</span>
          </li>
          <li>
            <strong>Izradi plan</strong>
            <span>Pretvori značajne pogreške u trening zadatke.</span>
          </li>
          <li>
            <strong>Treniraj i prati napredak</strong>
            <span>Rješavaj zadatke i vraćaj se na dospjele pozicije.</span>
          </li>
        </ol>
      </section>

      <section className="guide-section" aria-labelledby="import-title">
        <div className="guide-section-heading">
          <span>Unos partija</span>
          <h2 id="import-title">Kako dodati partiju u biblioteku</h2>
        </div>
        <div className="guide-import-options">
          <article>
            <h3>Učitavanje PGN datoteke</h3>
            <ol>
              <li>Otvori stranicu Import.</li>
              <li>Klikni „Učitaj PGN datoteku”.</li>
              <li>Odaberi datoteku s nastavkom .pgn.</li>
              <li>
                Partije se automatski dodaju u Biblioteku. Pričekaj poruku o
                uspješnom spremanju.
              </li>
            </ol>
          </article>
          <article>
            <h3>Ručni unos partije</h3>
            <ol>
              <li>Upiši turnir te imena bijelog i crnog igrača.</li>
              <li>Povlači figure po ploči ili upisuj poteze.</li>
              <li>Klikni „Dodaj partiju u biblioteku”.</li>
              <li>
                Ako naknadno promijeniš podatke, klikni „Spremi promjene u
                odabranu partiju”.
              </li>
            </ol>
          </article>
        </div>
        <p className="guide-tip">
          „Spremi trenutnu partiju” i „Spremi sve partije” preuzimaju PGN na
          uređaj. Koristi ih kao sigurnosnu kopiju.
        </p>
      </section>

      <section className="guide-section" aria-labelledby="analysis-title">
        <div className="guide-section-heading">
          <span>Analiza i trening</span>
          <h2 id="analysis-title">Preporučeni redoslijed rada</h2>
        </div>
        <div className="guide-workflow">
          <article>
            <strong>1. Analiza</strong>
            <p>
              Odaberi partije i postavke, klikni „Pripremi preview”, potvrdi
              stvaranje posla, a zatim klikni „Pokreni Stockfish”.
            </p>
          </article>
          <article>
            <strong>2. Rezultati igrača</strong>
            <p>
              Nakon dovršetka posla odaberi analizu i profil, pripremi preview
              te spremi personalizirane rezultate.
            </p>
          </article>
          <article>
            <strong>3. Profil i identitet</strong>
            <p>
              U Igračima pregledaj izvještaj. Ako je isto ime zapisano na više
              načina, potvrdi alias ili spoji profile u Identitetima.
            </p>
          </article>
          <article>
            <strong>4. Plan i trening</strong>
            <p>
              U Planu treninga odaberi igrača i prag pogreške, spremi zadatke,
              zatim ih rješavaj u Treningu i prati rezultate u Napretku.
            </p>
          </article>
        </div>
      </section>

      <section className="guide-section" aria-labelledby="areas-title">
        <div className="guide-section-heading">
          <span>Pregled izbornika</span>
          <h2 id="areas-title">Čemu služi svaki dio aplikacije</h2>
        </div>
        <div className="guide-area-grid">
          {APP_AREAS.map((area) => (
            <Link key={area.path} to={area.path}>
              <strong>{area.title}</strong>
              <span>{area.description}</span>
            </Link>
          ))}
        </div>
      </section>

      <aside className="guide-storage-note">
        <h2>Važno: alfa verzija i spremanje podataka</h2>
        <p>
          <strong>Chesscare je trenutačno alfa verzija.</strong> Funkcionalnosti
          Log in i Sign up još nisu aktivne, pa podaci nisu povezani s
          korisničkim računom niti se spremaju u oblak.
        </p>
        <ul>
          <li>
            Biblioteka, analize, zadaci i napredak čuvaju se samo u pregledniku
            na uređaju na kojem koristiš aplikaciju.
          </li>
          <li>
            Drugi mobitel, računalo ili preglednik neće automatski imati iste
            podatke.
          </li>
          <li>
            Brisanje podataka preglednika, vraćanje uređaja ili uklanjanje
            podataka web-stranice može trajno ukloniti spremljeni sadržaj.
          </li>
          <li>
            Poželjno je redovito koristiti „Spremi sve partije” i čuvati PGN
            datoteke na hard disku ili drugom sigurnom mjestu. Spremi i sve
            ostale podatke za koje aplikacija nudi izvoz.
          </li>
        </ul>
      </aside>
    </main>
  );
}
