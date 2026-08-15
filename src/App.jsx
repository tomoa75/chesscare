import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
  useSearchParams,
} from "react-router-dom";
import "./App.css";

const Pocetna = lazy(() => import("./components/Pocetna"));
const Import = lazy(() => import("./components/Import"));
const Trening = lazy(() => import("./components/Trening"));
const DomainDiagnostics = lazy(
  () => import("./components/DomainDiagnostics"),
);
const DomainGameLibrary = lazy(
  () => import("./components/DomainGameLibrary"),
);
const AnalysisJobsDashboard = lazy(
  () => import("./components/AnalysisJobsDashboard"),
);
const PersonalizedDashboard = lazy(
  () => import("./components/PersonalizedDashboard"),
);
const TrainingPlanDashboard = lazy(
  () => import("./components/TrainingPlanDashboard"),
);
const PersonalizedTrainingSession = lazy(
  () => import("./components/PersonalizedTrainingSession"),
);
const TrainingProgressDashboard = lazy(
  () => import("./components/TrainingProgressDashboard"),
);
const PlayerIdentityDashboard = lazy(
  () => import("./components/PlayerIdentityDashboard"),
);

// 1. Definiramo tri jednostavne komponente (stranice)

function LegacyTrainingRedirect() {
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get("gameId");

  if (gameId) {
    return (
      <Navigate
        replace
        to={`/position-analysis?${searchParams.toString()}`}
      />
    );
  }

  return <Navigate replace to="/training-session" />;
}

function App() {
  const navLinkClass = ({ isActive }) =>
    isActive ? "nav-link nav-link--active" : "nav-link";

  return (
    <Router>
      {/* 2. Navigacijski linkovi */}
      <nav aria-label="Glavna navigacija">
        <NavLink className={navLinkClass} end to="/">
          Glavna
        </NavLink>
        <NavLink className={navLinkClass} to="/import">
          Import
        </NavLink>
        <NavLink className={navLinkClass} to="/library">
          Biblioteka
        </NavLink>
        <NavLink className={navLinkClass} to="/analysis-jobs">
          Analiza
        </NavLink>
        <NavLink className={navLinkClass} to="/position-analysis">
          Analiza pozicije
        </NavLink>
        <NavLink className={navLinkClass} to="/players">
          Igraci
        </NavLink>
        <NavLink className={navLinkClass} to="/player-identities">
          Identiteti
        </NavLink>
        <NavLink className={navLinkClass} to="/training-plan">
          Plan treninga
        </NavLink>
        <NavLink className={navLinkClass} to="/training-session">
          Trening
        </NavLink>
        <NavLink className={navLinkClass} to="/training-progress">
          Napredak
        </NavLink>
        <NavLink className={navLinkClass} to="/development">
          Dijagnostika
        </NavLink>
      </nav>

      {/* 3. Definiranje putanja */}
      <Suspense
        fallback={
          <main className="route-loading" role="status" aria-live="polite">
            Ucitavam stranicu...
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<Pocetna />} />
          <Route
            path="/statistics"
            element={<Navigate replace to="/analysis-jobs" />}
          />
          <Route path="/training" element={<LegacyTrainingRedirect />} />
          <Route path="/position-analysis" element={<Trening />} />
          <Route path="/import" element={<Import />} />
          <Route path="/library" element={<DomainGameLibrary />} />
          <Route path="/analysis-jobs" element={<AnalysisJobsDashboard />} />
          <Route path="/players" element={<PersonalizedDashboard />} />
          <Route
            path="/player-identities"
            element={<PlayerIdentityDashboard />}
          />
          <Route path="/training-plan" element={<TrainingPlanDashboard />} />
          <Route
            path="/training-session"
            element={<PersonalizedTrainingSession />}
          />
          <Route
            path="/training-progress"
            element={<TrainingProgressDashboard />}
          />
          <Route path="/development" element={<DomainDiagnostics />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
