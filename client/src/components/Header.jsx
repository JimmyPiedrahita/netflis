import React from 'react';

const Header = ({ user, logout }) => {
  return (
    <header className="app-header">
      <div className="logo-container">
        <img src="/logo.svg" alt="Logo" style={{ height: '40px', width: 'auto' }} />
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
