import { useCallback, useEffect, useState } from "react";
import {
  confirmPlayerAlias,
  confirmPlayerMerge,
  createAliasConfirmationPreview,
  createPlayerMergePreview,
  loadPlayerIdentityDashboard,
} from "../domain/playerIdentityService";
import {
  createBrowserDomainRepository,
  DOMAIN_STORAGE_CHANGED_EVENT,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import "../playerIdentityDashboard.css";

const MATCH_LABELS = {
  "same-tokens-different-order-or-punctuation":
    "isti tokeni, drugi redoslijed ili interpunkcija",
  "possible-diacritic-variant": "moguca varijanta dijakritika",
};

const EMPTY_OPERATION = {
  status: "idle",
  preview: null,
  result: null,
  error: null,
};

export default function PlayerIdentityDashboard() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [aliasForm, setAliasForm] = useState({
    playerId: "",
    alias: "",
  });
  const [aliasOperation, setAliasOperation] = useState(EMPTY_OPERATION);
  const [aliasConfirmed, setAliasConfirmed] = useState(false);
  const [mergeForm, setMergeForm] = useState({
    sourcePlayerId: "",
    targetPlayerId: "",
  });
  const [mergeOperation, setMergeOperation] = useState(EMPTY_OPERATION);
  const [mergeConfirmed, setMergeConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const repository = createBrowserDomainRepository(window);
      const dashboard = await loadPlayerIdentityDashboard({ repository });
      setData(dashboard);
      setLoadError(null);
    } catch (error) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleStorage = (event) => {
      if (
        event.key === DOMAIN_STORAGE_KEY ||
        event.detail?.key === DOMAIN_STORAGE_KEY
      ) void refresh();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DOMAIN_STORAGE_CHANGED_EVENT, handleStorage);
    };
  }, [refresh]);

  const updateAliasForm = (field, value) => {
    setAliasForm((current) => ({ ...current, [field]: value }));
    setAliasConfirmed(false);
    setAliasOperation(EMPTY_OPERATION);
  };

  const prepareAlias = async () => {
    setAliasConfirmed(false);
    setAliasOperation({
      ...EMPTY_OPERATION,
      status: "preparing",
    });
    try {
      const repository = createBrowserDomainRepository(window);
      const preview = await createAliasConfirmationPreview({
        repository,
        playerId: aliasForm.playerId,
        alias: aliasForm.alias,
      });
      setAliasOperation({
        status: "ready",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setAliasOperation({
        ...EMPTY_OPERATION,
        status: "error",
        error: error.message,
      });
    }
  };

  const saveAlias = async () => {
    const preview = aliasOperation.preview;
    if (!preview || !aliasConfirmed) return;
    setAliasOperation((current) => ({
      ...current,
      status: "saving",
      error: null,
    }));
    try {
      const repository = createBrowserDomainRepository(window);
      const result = await confirmPlayerAlias({
        repository,
        playerId: preview.player.id,
        alias: preview.alias,
        referenceTime: preview.referenceTime,
        previewToken: preview.token,
      });
      setAliasConfirmed(false);
      setAliasOperation((current) => ({
        ...current,
        status: "success",
        result,
        error: null,
      }));
      await refresh();
    } catch (error) {
      setAliasOperation((current) => ({
        ...current,
        status: "error",
        error: error.message,
      }));
    }
  };

  const updateMergeForm = (field, value) => {
    setMergeForm((current) => ({ ...current, [field]: value }));
    setMergeConfirmed(false);
    setMergeOperation(EMPTY_OPERATION);
  };

  const selectSuggestedMerge = (sourcePlayerId, targetPlayerId) => {
    setMergeForm({ sourcePlayerId, targetPlayerId });
    setMergeConfirmed(false);
    setMergeOperation(EMPTY_OPERATION);
  };

  const prepareMerge = async () => {
    setMergeConfirmed(false);
    setMergeOperation({
      ...EMPTY_OPERATION,
      status: "preparing",
    });
    try {
      const repository = createBrowserDomainRepository(window);
      const preview = await createPlayerMergePreview({
        repository,
        sourcePlayerId: mergeForm.sourcePlayerId,
        targetPlayerId: mergeForm.targetPlayerId,
      });
      setMergeOperation({
        status: "ready",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setMergeOperation({
        ...EMPTY_OPERATION,
        status: "error",
        error: error.message,
      });
    }
  };

  const saveMerge = async () => {
    const preview = mergeOperation.preview;
    if (!preview || !mergeConfirmed) return;
    setMergeOperation((current) => ({
      ...current,
      status: "saving",
      error: null,
    }));
    try {
      const repository = createBrowserDomainRepository(window);
      const result = await confirmPlayerMerge({
        repository,
        sourcePlayerId: preview.source.id,
        targetPlayerId: preview.target.id,
        referenceTime: preview.referenceTime,
        previewToken: preview.token,
      });
      setMergeConfirmed(false);
      setMergeOperation((current) => ({
        ...current,
        status: "success",
        result,
        error: null,
      }));
      setMergeForm({ sourcePlayerId: "", targetPlayerId: "" });
      await refresh();
    } catch (error) {
      setMergeOperation((current) => ({
        ...current,
        status: "error",
        error: error.message,
      }));
    }
  };

  if (loadError) {
    return (
      <main className="identity-page">
        <section className="identity-state identity-error">
          <h1>Identiteti nisu dostupni</h1>
          <p>{loadError}</p>
          <p>Podaci nisu promijenjeni.</p>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="identity-page">
        <section className="identity-state">Ucitavam profile igraca...</section>
      </main>
    );
  }

  const aliasPreview = aliasOperation.preview;
  const mergePreview = mergeOperation.preview;

  return (
    <main className="identity-page">
      <header className="identity-header">
        <div>
          <span>Rucna potvrda</span>
          <h1>Identiteti igraca</h1>
          <p>
            Slicna imena samo su kandidati za pregled. Niti jedan alias ili
            profil ne spaja se automatski.
          </p>
        </div>
        <dl>
          <div>
            <dt>Profili</dt>
            <dd>{data.summary.players}</dd>
          </div>
          <div>
            <dt>Aliasi</dt>
            <dd>{data.summary.aliases}</dd>
          </div>
          <div>
            <dt>Nerazrijeseno</dt>
            <dd>{data.summary.unresolvedNames}</dd>
          </div>
        </dl>
      </header>

      {data.conflicts.length > 0 && (
        <ul className="identity-warnings">
          {data.conflicts.map((conflict) => (
            <li key={conflict.normalizedAlias}>
              Alias <strong>{conflict.normalizedAlias}</strong> pripada
              profilima {conflict.playerIds.join(", ")}.
            </li>
          ))}
        </ul>
      )}

      <section className="identity-section">
        <h2>Postojeci profili</h2>
        <div className="identity-profiles">
          {data.players.map((player) => (
            <article key={player.id}>
              <h3>{player.displayName}</h3>
              <code>{player.id}</code>
              <div className="identity-aliases">
                {player.aliases.map((alias) => (
                  <span key={alias}>{alias}</span>
                ))}
              </div>
              <dl>
                <div>
                  <dt>Partije</dt>
                  <dd>{player.references.gameLinks}</dd>
                </div>
                <div>
                  <dt>Analize</dt>
                  <dd>{player.references.moveAnalyses}</dd>
                </div>
                <div>
                  <dt>Zadaci</dt>
                  <dd>{player.references.trainingTasks}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="identity-operation">
        <div className="identity-operation-heading">
          <div>
            <span>Operacija 1</span>
            <h2>Potvrdi novi alias</h2>
          </div>
          <p>
            Koristi se za PGN ime koje jos ne pripada drugom profilu. Ne
            mijenja veze koje vec pripadaju drugom playerId-u.
          </p>
        </div>

        {data.unresolvedNames.length > 0 && (
          <div className="identity-candidates">
            {data.unresolvedNames.map((candidate) => (
              <button
                type="button"
                key={candidate.normalizedName}
                onClick={() => updateAliasForm("alias", candidate.displayName)}
              >
                <strong>{candidate.displayName}</strong>
                <span>{candidate.count} pojavljivanja</span>
              </button>
            ))}
          </div>
        )}

        <div className="identity-form">
          <label>
            <span>Ciljni profil</span>
            <select
              value={aliasForm.playerId}
              onChange={(event) =>
                updateAliasForm("playerId", event.target.value)
              }
              disabled={aliasOperation.status === "saving"}
            >
              <option value="">Odaberi profil</option>
              {data.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Izvorni zapis aliasa</span>
            <input
              value={aliasForm.alias}
              onChange={(event) =>
                updateAliasForm("alias", event.target.value)
              }
              placeholder="Tocno ime iz PGN-a"
              disabled={aliasOperation.status === "saving"}
            />
          </label>
          <button
            type="button"
            onClick={prepareAlias}
            disabled={
              !aliasForm.playerId ||
              !aliasForm.alias.trim() ||
              aliasOperation.status === "preparing" ||
              aliasOperation.status === "saving"
            }
          >
            {aliasOperation.status === "preparing"
              ? "Pripremam..."
              : "Pripremi preview"}
          </button>
        </div>

        {aliasPreview && (
          <div className="identity-preview">
            <p>
              Alias <strong>{aliasPreview.alias}</strong> dodaje se profilu{" "}
              <strong>{aliasPreview.player.displayName}</strong>.
            </p>
            <p>
              Pronadeno PGN pojavljivanja:{" "}
              <strong>{aliasPreview.summary.occurrences}</strong>
            </p>
            {aliasPreview.conflicts.length > 0 && (
              <ul className="identity-warnings">
                {aliasPreview.conflicts.map((conflict, index) => (
                  <li key={`${conflict.code}-${index}`}>
                    {conflict.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {aliasPreview?.canConfirm && (
          <div className="identity-confirm">
            <label>
              <input
                type="checkbox"
                checked={aliasConfirmed}
                onChange={(event) => setAliasConfirmed(event.target.checked)}
              />
              Potvrdujem tocno prikazani alias i ciljni profil.
            </label>
            <button
              type="button"
              onClick={saveAlias}
              disabled={
                !aliasConfirmed || aliasOperation.status === "saving"
              }
            >
              Potvrdi alias
            </button>
          </div>
        )}

        {aliasOperation.error && (
          <p className="identity-message identity-error">
            {aliasOperation.error}
          </p>
        )}
        {aliasOperation.status === "success" && (
          <p className="identity-message identity-success">
            Alias je potvrden.
          </p>
        )}
      </section>

      <section className="identity-operation">
        <div className="identity-operation-heading">
          <div>
            <span>Operacija 2</span>
            <h2>Spoji dva profila</h2>
          </div>
          <p>
            Izvorni profil bit ce uklonjen, a sve njegove partije, analize,
            zadaci i pokusaji preusmjereni na ciljni profil.
          </p>
        </div>

        {data.possibleMatches.length > 0 && (
          <div className="identity-match-list">
            {data.possibleMatches.map((match) => (
              <article
                key={`${match.leftPlayerId}-${match.rightPlayerId}`}
              >
                <div>
                  <strong>
                    {match.leftDisplayName} ↔ {match.rightDisplayName}
                  </strong>
                  <span>{MATCH_LABELS[match.reason]}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    selectSuggestedMerge(
                      match.rightPlayerId,
                      match.leftPlayerId,
                    )
                  }
                >
                  Pregledaj spajanje
                </button>
              </article>
            ))}
          </div>
        )}

        <div className="identity-form">
          <label>
            <span>Izvorni profil koji se uklanja</span>
            <select
              value={mergeForm.sourcePlayerId}
              onChange={(event) =>
                updateMergeForm("sourcePlayerId", event.target.value)
              }
              disabled={mergeOperation.status === "saving"}
            >
              <option value="">Odaberi izvor</option>
              {data.players.map((player) => (
                <option
                  key={player.id}
                  value={player.id}
                  disabled={player.id === mergeForm.targetPlayerId}
                >
                  {player.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ciljni profil koji ostaje</span>
            <select
              value={mergeForm.targetPlayerId}
              onChange={(event) =>
                updateMergeForm("targetPlayerId", event.target.value)
              }
              disabled={mergeOperation.status === "saving"}
            >
              <option value="">Odaberi cilj</option>
              {data.players.map((player) => (
                <option
                  key={player.id}
                  value={player.id}
                  disabled={player.id === mergeForm.sourcePlayerId}
                >
                  {player.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={prepareMerge}
            disabled={
              !mergeForm.sourcePlayerId ||
              !mergeForm.targetPlayerId ||
              mergeOperation.status === "preparing" ||
              mergeOperation.status === "saving"
            }
          >
            {mergeOperation.status === "preparing"
              ? "Pripremam..."
              : "Pripremi preview"}
          </button>
        </div>

        {mergePreview && (
          <div className="identity-preview">
            <p>
              <strong>{mergePreview.source.displayName}</strong> spaja se u{" "}
              <strong>{mergePreview.target.displayName}</strong>.
            </p>
            <div className="identity-change-grid">
              {Object.entries(mergePreview.changes).map(([key, value]) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p>
              Aliasi nakon spajanja: {mergePreview.mergedAliases.join(", ")}
            </p>
            {mergePreview.conflicts.length > 0 && (
              <ul className="identity-warnings">
                {mergePreview.conflicts.map((conflict, index) => (
                  <li key={`${conflict.code}-${index}`}>
                    {conflict.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mergePreview?.canMerge && (
          <div className="identity-confirm identity-confirm-danger">
            <label>
              <input
                type="checkbox"
                checked={mergeConfirmed}
                onChange={(event) => setMergeConfirmed(event.target.checked)}
              />
              Potvrdujem uklanjanje izvornog profila i preusmjeravanje svih
              prikazanih veza.
            </label>
            <button
              type="button"
              onClick={saveMerge}
              disabled={
                !mergeConfirmed || mergeOperation.status === "saving"
              }
            >
              Spoji profile
            </button>
          </div>
        )}

        {mergeOperation.error && (
          <p className="identity-message identity-error">
            {mergeOperation.error}
          </p>
        )}
        {mergeOperation.status === "success" && (
          <p className="identity-message identity-success">
            Profili su spojeni i veze su preusmjerene.
          </p>
        )}
      </section>
    </main>
  );
}
