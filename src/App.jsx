import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";

const Pocetna = lazy(() => import("./components/Pocetna"));
const Import = lazy(() => import("./components/Import"));
const Trening = lazy(() => import("./components/Trening"));
const Statistika = lazy(() => import("./components/Statistika"));
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

function App() {
  return (
    <Router>
      {/* 2. Navigacijski linkovi (umjesto <a> koristimo <Link>) */}
      <nav>
        <Link to="/">Glavna</Link> <Link to="/statistics"> Statistika</Link>
        <Link to="/training"> Trening</Link>
        <Link to="/import"> Import</Link>
        <Link to="/library"> Biblioteka</Link>
        <Link to="/analysis-jobs"> Poslovi</Link>
        <Link to="/players"> Igraci</Link>
        <Link to="/player-identities"> Identiteti</Link>
        <Link to="/training-plan"> Novi trening</Link>
        <Link to="/training-session"> Vjezbaj</Link>
        <Link to="/training-progress"> Napredak</Link>
        <Link to="/development"> Dijagnostika</Link>
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
          <Route path="/statistics" element={<Statistika />} />
          <Route path="/training" element={<Trening />} />
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
