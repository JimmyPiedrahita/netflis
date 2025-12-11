import React, { useState } from 'react';
import { LinkIcon, ExitIcon, CheckIcon } from './Icons';

const RoomInfo = ({ onLeave }) => {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room-info">
      <span className="status-badge">
        <span className="live-indicator"></span>
        Activa
      </span>
      <div className="room-actions">
        <button onClick={copyLink} className="btn btn-copy" disabled={copied}>
          {copied ? <CheckIcon /> : <LinkIcon />}
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
        <button onClick={onLeave} className="btn btn-leave" title="Salir de la sala">
          <ExitIcon />
        </button>
      </div>
    </div>
  );
};

export default RoomInfo;
