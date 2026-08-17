export default function Login() {
  return (
    <div className="home-login" aria-describedby="home-login-status">
      <input aria-label="Log in" placeholder="LOG IN" disabled />
      <input aria-label="Sign up" placeholder="SIGN UP" disabled />
      <p id="home-login-status" className="home-login-note">
        Alfa verzija: Log in i Sign up još nisu aktivni.
      </p>
    </div>
  );
}
