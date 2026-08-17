import Header from "./Header";
import Login from "./Login";
import chesscare from "../assets/chesscare.svg";
export default function Pocetna() {
  return (
    <main className="home-page">
      <Header />
      <Login />
      <img
        className="home-illustration"
        src={chesscare}
        alt="Chesscare ilustracija"
      />
    </main>
  );
}
