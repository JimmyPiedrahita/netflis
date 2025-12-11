import React from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { GoogleIcon } from './Icons';

const Login = ({ onSuccess, roomId }) => {
  const login = useGoogleLogin({
    onSuccess: onSuccess,
    onError: (error) => console.log("Login fallo:", error),
    scope: "https://www.googleapis.com/auth/drive.readonly"
  });

  return (
    <div className="login-container">
      {roomId && <p className="invite-message">Inicia sesión para entrar a la sala.</p>}
      <button onClick={() => login()} className="btn btn-google">
        <GoogleIcon />
        <span>Iniciar sesión con Google</span>
      </button>
    </div>
  );
};

export default Login;
