import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteDomainGame,
  previewDomainGameDeletion,
} from "../domain/gameLibraryActionService";
import { loadDomainGameLibrary } from "../domain/gameLibraryService";
import {
  createBrowserDomainRepository,
  DOMAIN_STORAGE_CHANGED_EVENT,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import PgnSaver from "./Pgnsaver";
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

function pgnFileName(title) {
  const safeTitle = title
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeTitle || "partija"}.pgn`;
}

export default function DomainGameLibrary() {
  const repository = useMemo(
    () => createBrowserDomainRepository(window),
    [],
  );
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });
  const [deletion, setDeletion] = useState({
    status: "idle",
    gameId: null,
    preview: null,
    confirmed: false,
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
      if (
        event.key === DOMAIN_STORAGE_KEY ||
        event.detail?.key === DOMAIN_STORAGE_KEY
      ) void loadLibrary();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);

    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    };
  }, [filters, repository]);

  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const openDeletionPreview = async (gameId) => {
    setDeletion({
      status: "loading",
      gameId,
      preview: null,
      confirmed: false,
      error: null,
    });

    try {
      const preview = await previewDomainGameDeletion({ repository, gameId });
      setDeletion({
        status: "ready",
        gameId,
        preview,
        confirmed: false,
        error: null,
      });
    } catch (error) {
      setDeletion({
        status: "error",
        gameId,
        preview: null,
        confirmed: false,
        error: error.message,
      });
    }
  };

  const confirmDeletion = async () => {
    const { gameId, preview, confirmed } = deletion;
    if (!gameId || !preview?.canDelete || !confirmed) return;

    setDeletion((current) => ({
      ...current,
      status: "deleting",
      error: null,
    }));
    try {
      await deleteDomainGame({
        repository,
        gameId,
        confirmationToken: preview.confirmationToken,
      });
      setDeletion({
        status: "idle",
        gameId: null,
        preview: null,
        confirmed: false,
        error: null,
      });
    } catch (error) {
      setDeletion((current) => ({
        ...current,
        status: "error",
        confirmed: false,
        error: error.message,
      }));
    }
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
            Sredisnje mjesto za pregled, izvoz, analizu i upravljanje
            partijama spremljenima u novom domenskom repozitoriju.
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

                  <div className="library-actions" aria-label={`Akcije za ${game.title}`}>
                    <Link to={`/import?gameId=${encodeURIComponent(game.id)}`}>
                      Otvori u Importu
                    </Link>
                    <Link
                      to={`/analysis-jobs?gameId=${encodeURIComponent(game.id)}`}
                    >
                      Pokreni analizu
                    </Link>
                    <Link
                      to={`/position-analysis?gameId=${encodeURIComponent(game.id)}`}
                    >
                      Analiziraj poziciju
                    </Link>
                    <PgnSaver
                      pgnText={game.rawPgn}
                      fileName={pgnFileName(game.title)}
                      buttonText="Izvezi PGN"
                    />
                    <button
                      type="button"
                      className="library-delete-button"
                      onClick={() => void openDeletionPreview(game.id)}
                    >
                      Obrisi
                    </button>
                  </div>

                  {deletion.gameId === game.id && (
                    <section className="library-delete-preview" aria-live="polite">
                      {deletion.status === "loading" && (
                        <p>Provjeravam povezane podatke...</p>
                      )}
                      {deletion.error && <p className="library-delete-error">{deletion.error}</p>}
                      {deletion.preview && (
                        <>
                          <h3>Utjecaj brisanja</h3>
                          {deletion.preview.canDelete ? (
                            <>
                              <ul>
                                <li>{deletion.preview.removals.games} partija</li>
                                <li>{deletion.preview.removals.analysisRuns} analiza</li>
                                <li>{deletion.preview.removals.moveAnalyses} rezultata poteza</li>
                                <li>{deletion.preview.removals.trainingTasks} trening-zadataka</li>
                                <li>{deletion.preview.removals.trainingAttempts} pokusaja treninga</li>
                              </ul>
                              <p>
                                Cache evaluacija pozicija ostaje sacuvan jer se moze
                                dijeliti s drugim partijama.
                              </p>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={deletion.confirmed}
                                  onChange={(event) =>
                                    setDeletion((current) => ({
                                      ...current,
                                      confirmed: event.target.checked,
                                    }))
                                  }
                                />
                                Razumijem da se navedeni podaci trajno brisu.
                              </label>
                              <button
                                type="button"
                                className="library-confirm-delete"
                                disabled={
                                  !deletion.confirmed ||
                                  deletion.status === "deleting"
                                }
                                onClick={() => void confirmDeletion()}
                              >
                                {deletion.status === "deleting"
                                  ? "Brisem..."
                                  : "Potvrdi brisanje"}
                              </button>
                            </>
                          ) : (
                            <p className="library-delete-error">
                              Brisanje je blokirano: partija pripada analizi s vise
                              partija ({deletion.preview.blockers
                                .map((blocker) => blocker.analysisRunId)
                                .join(", ")}).
                            </p>
                          )}
                          <button
                            type="button"
                            className="library-cancel-delete"
                            onClick={() =>
                              setDeletion({
                                status: "idle",
                                gameId: null,
                                preview: null,
                                confirmed: false,
                                error: null,
                              })
                            }
                          >
                            Odustani
                          </button>
                        </>
                      )}
                    </section>
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
