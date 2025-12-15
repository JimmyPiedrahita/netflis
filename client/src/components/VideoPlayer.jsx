import React, { useEffect } from 'react';

const VideoPlayer = ({ 
  videoRef, 
  currentVideo, 
  onPlay, 
  onPause, 
  onSeek,
  onError // Recibimos la prop
}) => {
  if (!currentVideo) return null;

  return (
    <div className="video-player-container">
      <video 
        ref={videoRef}
        src={currentVideo.url} 
        controls 
        autoPlay 
        preload="auto"
        className="main-video"
        onPlay={onPlay}
        onPause={onPause}
        onSeeked={onSeek}
        onError={onError} // Conectamos el error
      />
      <div className="video-info">
        <span>Viendo: {currentVideo.name}</span>
      </div>
    </div>
  );
};

export default VideoPlayer;