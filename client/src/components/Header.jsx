import React from 'react';
import { LogoIcon } from './Icons';

const Header = ({ user, logout }) => {
  return (
    <header className="app-header">
      <div className="logo-container">
        <LogoIcon />
        <h1>Netflis</h1>
      </div>
      {user && (
        <button onClick={logout} className="btn btn-logout">
          Cerrar sesión
        </button>
      )}
    </header>
  );
};

export default Header;
