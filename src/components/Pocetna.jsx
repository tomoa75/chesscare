import { Link } from "react-router-dom";
import Header from "./Header";
import Login from "./Login";
import chesscare from "../assets/chesscare.svg";
export default function Pocetna() {
  return (
    <main className="home-page">
      <Header />
      <p className="home-intro">
        Chesscare sprema tvoje partije, analizira poteze pomoću Stockfisha i
        pretvara pronađene pogreške u personalizirane zadatke za trening.
      </p>
      <div className="home-actions">
        <Link className="home-primary-action" to="/import">
          Dodaj prvu partiju
        </Link>
        <Link className="home-secondary-action" to="/guide">
          Pročitaj upute
        </Link>
      </div>
      <Login />
      <img
        className="home-illustration"
        src={chesscare}
        alt="Chesscare ilustracija"
      />
    </main>
  );
}
