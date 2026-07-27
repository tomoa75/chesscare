import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadDomainGameLibrary } from "../domain/gameLibraryService";
import {
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../domainGameLibrary.css";

const EMPTY_FILTERS = {
  query: "",
  playerId: "",
  result: "",
  sort: "newest",
};

function formatImportedAt(value) {
  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PlayerName({ player }) {
  return (
    <span className={player.resolved ? "" : "library-unresolved-player"}>
      {player.name}
      {!player.resolved && <small>profil nije povezan</small>}
    </span>
  );
}

export default function DomainGameLibrary() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const loadLibrary = async () => {
      setState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const repository = createLocalStorageDomainRepository(
          window.localStorage,
        );
        const data = await loadDomainGameLibrary({ repository, filters });

        if (active) {
          setState({ status: "ready", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error.message,
          });
        }
      }
    };

    void loadLibrary();
    const handleStorage = (event) => {
      if (event.key === DOMAIN_STORAGE_KEY) void loadLibrary();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, [filters]);

  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  if (state.status === "loading" && !state.data) {
    return (
      <main className="library-page">
        <div className="library-state">Ucitavam domensku biblioteku...</div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="library-page">
        <div className="library-state library-error">
          <h1>Biblioteka nije dostupna</h1>
          <p>{state.error}</p>
          <p>
            Podaci nisu promijenjeni. Provjeri domenski snapshot u{" "}
            <Link to="/development">Dijagnostici</Link>.
          </p>
        </div>
      </main>
    );
  }

  const { data } = state;

  return (
    <main className="library-page">
      <header className="library-header">
        <div>
          <span className="library-eyebrow">Novi repository</span>
          <h1>Biblioteka partija</h1>
          <p>
            Read-only pregled migriranih partija i povezanih profila igraca.
            Postojeci Import, Trening i Statistika i dalje koriste legacy
            zbirku.
          </p>
        </div>
        <div className="library-summary">
          <strong>{data.summary.totalGames}</strong>
          <span>partija</span>
          <strong>{data.summary.totalPlayers}</strong>
          <span>igraca</span>
        </div>
      </header>

      {data.summary.totalGames === 0 ? (
        <section className="library-state">
          <h2>Domenska biblioteka je prazna</h2>
          <p>
            U Dijagnostici prvo pripremi preview i potvrdi migraciju postojecih
            partija.
          </p>
          <Link className="library-primary-link" to="/development">
            Otvori Dijagnostiku
          </Link>
        </section>
      ) : (
        <>
          <section className="library-controls" aria-label="Filteri partija">
            <label className="library-search">
              <span>Pretraga</span>
              <input
                type="search"
                value={filters.query}
                onChange={(event) =>
                  updateFilter("query", event.target.value)
                }
                placeholder="Naslov, igrac, dogadaj ili otvaranje"
              />
            </label>
            <label>
              <span>Igrac</span>
              <select
                value={filters.playerId}
                onChange={(event) =>
                  updateFilter("playerId", event.target.value)
                }
              >
                <option value="">Svi igraci</option>
                {data.players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Rezultat</span>
              <select
                value={filters.result}
                onChange={(event) =>
                  updateFilter("result", event.target.value)
                }
              >
                <option value="">Svi rezultati</option>
                <option value="1-0">1-0</option>
                <option value="0-1">0-1</option>
                <option value="1/2-1/2">Remi</option>
                <option value="*">Bez rezultata</option>
              </select>
            </label>
            <label>
              <span>Redoslijed</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  updateFilter("sort", event.target.value)
                }
              >
                <option value="newest">Najnoviji import</option>
                <option value="oldest">Najstariji import</option>
                <option value="title">Naslov</option>
              </select>
            </label>
          </section>

          <div className="library-results-heading">
            <span>
              Prikazano {data.summary.visibleGames} od{" "}
              {data.summary.totalGames} partija
            </span>
            {state.status === "loading" && <span>Osvjezavam...</span>}
          </div>

          {data.summary.unresolvedPlayerReferences > 0 && (
            <p className="library-warning">
              {data.summary.unresolvedPlayerReferences} referenci igraca nema
              povezani profil. Prikazana su izvorna imena iz PGN headera.
            </p>
          )}

          {data.games.length === 0 ? (
            <section className="library-state">
              <h2>Nema rezultata</h2>
              <p>Nijedna partija ne odgovara odabranim filtrima.</p>
              <button
                type="button"
                className="library-reset"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Ponisti filtre
              </button>
            </section>
          ) : (
            <section className="library-list">
              {data.games.map((game) => (
                <article className="library-game" key={game.id}>
                  <div className="library-game-heading">
                    <div>
                      <span>{game.event}</span>
                      <h2>{game.title}</h2>
                    </div>
                    <strong>{game.resultLabel}</strong>
                  </div>

                  <div className="library-players">
                    <PlayerName player={game.white} />
                    <b>vs</b>
                    <PlayerName player={game.black} />
                  </div>

                  <dl className="library-metadata">
                    <div>
                      <dt>Datum partije</dt>
                      <dd>{game.playedAt || "Nije naveden"}</dd>
                    </div>
                    <div>
                      <dt>Otvaranje</dt>
                      <dd>{game.opening || "Nije navedeno"}</dd>
                    </div>
                    <div>
                      <dt>Importirano</dt>
                      <dd>{formatImportedAt(game.importedAt)}</dd>
                    </div>
                    <div>
                      <dt>Izvor</dt>
                      <dd>{game.sourceFileName || game.sourceKind}</dd>
                    </div>
                  </dl>

                  <details className="library-pgn">
                    <summary>Prikazi izvorni PGN</summary>
                    <pre>{game.rawPgn}</pre>
                  </details>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

