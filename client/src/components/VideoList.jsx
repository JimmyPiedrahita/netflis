import React from 'react';
import { FilmIcon, PlayIcon } from './Icons';

const VideoList = ({ files, loading, joinedRoom, isHost, onSelectVideo }) => {
  if (joinedRoom && !isHost) return null;

  return (
    <div className="video-list-container">

      {loading && <div className="loading">Cargando videos...</div>}
      
      {!loading && files.length === 0 && (
        <div className="no-videos">
          <p>No se encontraron videos en tu Google Drive.</p>
        </div>
      )}
      
      <div className="video-grid">
        {files.map((file) => (
          <div key={file.id} className="video-card">
            <div className="video-icon">
              <FilmIcon />
            </div>
            <h4 className="video-title" title={file.name}>{file.name}</h4>
            <button 
              onClick={() => onSelectVideo(file)}
              className="btn btn-play"
            >
              <PlayIcon />
              Reproducir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoList;
