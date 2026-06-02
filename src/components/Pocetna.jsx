import Header from "./Header";
import Login from "./Login";
import chesscare from "../assets/chesscare.svg";
export default function Pocetna() {
  return (
    <>
      <Header />
      <Login />
      <img src={chesscare}></img>
    </>
  );
}
