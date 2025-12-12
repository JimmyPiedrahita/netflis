import React, { useState } from 'react';
import { LinkIcon, ExitIcon, CheckIcon, UsersIcon } from './Icons';

const RoomInfo = ({ onLeave, participantCount }) => {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room-info">
      <div className="room-status-group">
        <span className="status-badge">
          <span className="live-indicator"></span>
        </span>
        <span className="participant-count" title="Usuarios en la sala">
          <UsersIcon />
          {participantCount}
        </span>
      </div>
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
