import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Pocetna from "./components/Pocetna";
import Import from "./components/Import";

// 1. Definiramo tri jednostavne komponente (stranice)

const Statistika = () => <h1>Statistika korisnika</h1>;
const Trening = () => <h1>Plan treninga</h1>;

function App() {
  return (
    <Router>
      {/* 2. Navigacijski linkovi (umjesto <a> koristimo <Link>) */}
      <nav>
        <Link to="/">Glavna</Link> <Link to="/statistics"> Statistika</Link>
        <Link to="/training"> Trening</Link>
        <Link to="/import"> Import</Link>
      </nav>

      {/* 3. Definiranje putanja */}
      <Routes>
        <Route path="/" element={<Pocetna />} />
        <Route path="/statistics" element={<Statistika />} />
        <Route path="/training" element={<Trening />} />
        <Route path="/import" element={<Import />} />
      </Routes>
    </Router>
  );
}

export default App;
