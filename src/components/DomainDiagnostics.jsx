import { useEffect, useState } from "react";
import {
  loadSavedGames,
  subscribeToSavedGames,
} from "../gameStorage";
import { loadDomainDiagnostics } from "../domain/domainDiagnosticsService";
import {
  createLegacyMigrationPreview,
  executeLegacyMigration,
} from "../domain/legacyMigrationService";
import "../domainDiagnostics.css";

const LEGACY_METRICS = [
  ["recordsReceived", "Legacy zapisa"],
  ["gamesConverted", "Pretvoreno partija"],
  ["gamesRejected", "Odbijeno partija"],
  ["playersProposed", "Predlozeno igraca"],
  ["duplicatesFound", "Duplikata"],
  ["possiblePlayerMatches", "Mogucih aliasa"],
  ["warnings", "Upozorenja"],
];

const DOMAIN_METRICS = [
  ["players", "Igraci"],
  ["games", "Partije"],
  ["analysisRuns", "Analiticki poslovi"],
  ["moveAnalyses", "Analizirani potezi"],
  ["positionEvaluations", "Cache pozicije"],
  ["trainingTasks", "Trening zadaci"],
  ["trainingAttempts", "Trening pokusaji"],
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function MetricGrid({ metrics, values }) {
  return (
    <div className="diagnostics-grid">
      {metrics.map(([key, label]) => (
        <article className="diagnostics-card" key={key}>
          <span>{label}</span>
          <strong>{values[key]}</strong>
        </article>
      ))}
    </div>
  );
}

export default function DomainDiagnostics() {
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });
  const [migration, setMigration] = useState({
    status: "idle",
    preview: null,
    result: null,
    error: null,
  });
  const [migrationConfirmed, setMigrationConfirmed] = useState(false);

  useEffect(() => {
    let active = true;

    const refresh = async (legacyRecords = loadSavedGames()) => {
      setState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const data = await loadDomainDiagnostics({
          legacyRecords,
          storage: window.localStorage,
        });

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

    void refresh();
    const unsubscribe = subscribeToSavedGames((records) => {
      void refresh(records);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const prepareMigration = async () => {
    setMigration({
      status: "preparing",
      preview: null,
      result: null,
      error: null,
    });
    setMigrationConfirmed(false);

    try {
      const preview = await createLegacyMigrationPreview({
        legacyRecords: loadSavedGames(),
        storage: window.localStorage,
      });
      setMigration({
        status: "preview",
        preview,
        result: null,
        error: null,
      });
    } catch (error) {
      setMigration({
        status: "error",
        preview: null,
        result: null,
        error: error.message,
      });
    }
  };

  const confirmMigration = async () => {
    if (!migration.preview || !migrationConfirmed) return;

    setMigration((current) => ({
      ...current,
      status: "migrating",
      error: null,
    }));

    try {
      const result = await executeLegacyMigration({
        legacyRecords: loadSavedGames(),
        storage: window.localStorage,
        previewToken: migration.preview.token,
      });
      const data = await loadDomainDiagnostics({
        legacyRecords: loadSavedGames(),
        storage: window.localStorage,
      });

      setState({ status: "ready", data, error: null });
      setMigration({
        status: "success",
        preview: migration.preview,
        result,
        error: null,
      });
      setMigrationConfirmed(false);
    } catch (error) {
      setMigration((current) => ({
        ...current,
        status: "error",
        error: error.message,
      }));
    }
  };

  if (state.status === "loading" && !state.data) {
    return (
      <main className="diagnostics-page">
        <div className="diagnostics-state">Ucitavam read-only izvjestaj...</div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="diagnostics-page">
        <div className="diagnostics-state diagnostics-error">
          <h1>Dijagnostika nije dostupna</h1>
          <p>{state.error}</p>
        </div>
      </main>
    );
  }

  const { data } = state;

  return (
    <main className="diagnostics-page">
      <header className="diagnostics-header">
        <div>
          <span className="diagnostics-eyebrow">Razvojni prikaz</span>
          <h1>Domenski read-only izvjestaj</h1>
          <p>
            Izvjestaj i migracijski preview samo citaju podatke. Migracija se
            nikada ne pokrece automatski i zahtijeva zasebnu potvrdu.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="diagnostics-refresh"
        >
          Osvjezi prikaz
        </button>
      </header>

      <section className="diagnostics-section">
        <div className="diagnostics-section-heading">
          <div>
            <h2>Legacy zbirka</h2>
            <p>Simulacija pretvorbe zapisa iz `chesscare.savedGames`.</p>
          </div>
          {state.status === "loading" && <span>Osvjezavam...</span>}
        </div>
        <MetricGrid metrics={LEGACY_METRICS} values={data.legacy} />
      </section>

      <section className="diagnostics-section">
        <div className="diagnostics-section-heading">
          <div>
            <h2>Novi domenski snapshot</h2>
            <p>
              Trenutni sadrzaj kljuca <code>{data.storageKey}</code>.
            </p>
          </div>
        </div>
        <MetricGrid metrics={DOMAIN_METRICS} values={data.domain} />
      </section>

      <section className="diagnostics-section">
        <div className="diagnostics-section-heading">
          <div>
            <h2>Procjena volumena pohrane</h2>
            <p>
              Read-only procjena UTF-16 veličine. Prag je konzervativna
              aplikacijska granica, a ne tvrdnja o kvoti konkretnog preglednika.
            </p>
          </div>
        </div>
        <div className="diagnostics-grid">
          <article className="diagnostics-card">
            <span>Legacy zapis</span>
            <strong>{formatBytes(data.storageUsage.legacyBytes)}</strong>
          </article>
          <article className="diagnostics-card">
            <span>Domenski snapshot</span>
            <strong>{formatBytes(data.storageUsage.domainBytes)}</strong>
          </article>
          <article className="diagnostics-card">
            <span>Ukupno procijenjeno</span>
            <strong>{formatBytes(data.storageUsage.totalBytes)}</strong>
          </article>
          <article className="diagnostics-card">
            <span>Prag za IndexedDB procjenu</span>
            <strong>
              {formatBytes(data.storageUsage.warningThresholdBytes)}
            </strong>
          </article>
        </div>
        <p
          className={
            data.storageUsage.status === "indexeddb-recommended"
              ? "storage-recommendation storage-recommendation-warning"
              : "storage-recommendation"
          }
        >
          {data.storageUsage.status === "indexeddb-recommended"
            ? "Procijenjeni volumen dosegao je prag: preporucuje se prijelaz na IndexedDB prije daljnjeg rasta."
            : "Procijenjeni volumen je ispod praga; localStorage je zasad prihvatljiv za ovu zbirku."}
        </p>
      </section>

      <section className="diagnostics-section migration-panel">
        <div className="diagnostics-section-heading">
          <div>
            <h2>Kontrolirana migracija</h2>
            <p>
              Prvo pripremi read-only preview. Prije prvog domenskog zapisa
              stvara se zasebna sigurnosna kopija, a legacy zbirka ostaje
              netaknuta.
            </p>
          </div>
          <button
            type="button"
            className="diagnostics-secondary-button"
            onClick={prepareMigration}
            disabled={
              migration.status === "preparing" ||
              migration.status === "migrating"
            }
          >
            {migration.status === "preparing"
              ? "Pripremam..."
              : "Pripremi preview"}
          </button>
        </div>

        {migration.preview && (
          <div className="migration-preview">
            <div className="diagnostics-grid migration-grid">
              <article className="diagnostics-card">
                <span>Novi igraci</span>
                <strong>{migration.preview.report.playersAdded}</strong>
              </article>
              <article className="diagnostics-card">
                <span>Nove partije</span>
                <strong>{migration.preview.report.gamesAdded}</strong>
              </article>
              <article className="diagnostics-card">
                <span>Preskoceni igraci</span>
                <strong>{migration.preview.report.playersSkipped}</strong>
              </article>
              <article className="diagnostics-card">
                <span>Preskocene partije</span>
                <strong>{migration.preview.report.gamesSkipped}</strong>
              </article>
            </div>

            {migration.preview.report.conflicts.length > 0 && (
              <p className="migration-warning">
                Preview sadrzi {migration.preview.report.conflicts.length} ID
                konflikata. Postojece partije nece biti prepisane.
              </p>
            )}

            {migration.preview.hasChanges ? (
              <>
                <label className="migration-confirmation">
                  <input
                    type="checkbox"
                    checked={migrationConfirmed}
                    onChange={(event) =>
                      setMigrationConfirmed(event.target.checked)
                    }
                    disabled={migration.status === "migrating"}
                  />
                  <span>
                    Potvrdujem migraciju prikazanih zapisa uz prethodno
                    stvaranje sigurnosne kopije.
                  </span>
                </label>
                <button
                  type="button"
                  className="diagnostics-migrate-button"
                  onClick={confirmMigration}
                  disabled={
                    !migrationConfirmed ||
                    migration.status === "migrating"
                  }
                >
                  {migration.status === "migrating"
                    ? "Migriram..."
                    : "Potvrdi i migriraj"}
                </button>
              </>
            ) : (
              <p className="diagnostics-empty">
                Nema novih igraca ili partija za migraciju.
              </p>
            )}
          </div>
        )}

        {migration.status === "error" && (
          <p className="migration-message migration-message-error">
            {migration.error}
          </p>
        )}

        {migration.status === "success" && (
          <div className="migration-message migration-message-success">
            <strong>Migracija je zavrsena.</strong>
            {migration.result.backupKey && (
              <span>
                Sigurnosna kopija: <code>{migration.result.backupKey}</code>
              </span>
            )}
          </div>
        )}
      </section>

      <div className="diagnostics-columns">
        <section className="diagnostics-section">
          <h2>Upozorenja</h2>
          {data.legacy.warningDetails.length > 0 ? (
            <ul className="diagnostics-list">
              {data.legacy.warningDetails.map((item, index) => (
                <li key={`${item.code}-${item.recordIndex}-${index}`}>
                  <strong>{item.code}</strong>
                  <span>{item.message}</span>
                  <small>
                    Zapis {item.recordIndex ?? "-"} · {item.severity}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="diagnostics-empty">Nema upozorenja.</p>
          )}
        </section>

        <section className="diagnostics-section">
          <h2>Moguca podudaranja igraca</h2>
          {data.possiblePlayerMatches.length > 0 ? (
            <ul className="diagnostics-list">
              {data.possiblePlayerMatches.map((match) => (
                <li key={`${match.leftPlayerId}-${match.rightPlayerId}`}>
                  <strong>
                    {match.leftSourceNames.join(", ")} ↔{" "}
                    {match.rightSourceNames.join(", ")}
                  </strong>
                  <span>{match.reason}</span>
                  <small>Samo rucna provjera; nije automatski spojeno.</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="diagnostics-empty">
              Nema mogucih alias podudaranja.
            </p>
          )}
        </section>
      </div>

      <section className="diagnostics-section">
        <h2>Grupe duplikata</h2>
        {data.duplicateGroups.length > 0 ? (
          <ul className="diagnostics-list">
            {data.duplicateGroups.map((group) => (
              <li key={group.fingerprint}>
                <strong>{group.gameIds.length} jednaka zapisa</strong>
                <span>{group.gameIds.join(", ")}</span>
                <small>{group.fingerprint}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="diagnostics-empty">Nisu pronadjeni duplikati.</p>
        )}
      </section>
    </main>
  );
}
