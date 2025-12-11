import React from 'react';
import { LinkIcon } from './Icons';

const RoomInfo = () => {
  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert("¡Enlace copiado!");
  };

  return (
    <div className="room-info">
      <span className="status-badge">
        <span className="live-indicator"></span>
        Sala Activa
      </span>
      <button onClick={copyLink} className="btn btn-copy">
        <LinkIcon />
        Copiar Enlace
      </button>
    </div>
  );
};

export default RoomInfo;
