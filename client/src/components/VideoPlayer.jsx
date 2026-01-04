import React, { useEffect, useState, useCallback } from 'react';

const VideoPlayer = ({ 
  videoRef, 
  currentVideo, 
  onPlay, 
  onPause, 
  onSeek,
  onError
}) => {
  const [bufferProgress, setBufferProgress] = useState(0);

  // Monitorear el buffer
  const handleProgress = useCallback(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    if (video.buffered.length > 0) {
      // Obtener el último rango de buffer
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const duration = video.duration;
      if (duration > 0) {
        const percent = (bufferedEnd / duration) * 100;
        setBufferProgress(percent);
        console.log(`[BUFFER] Precargado: ${bufferedEnd.toFixed(1)}s / ${duration.toFixed(1)}s (${percent.toFixed(1)}%)`);
      }
    }
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('progress', handleProgress);
    // También revisar al cargar metadata
    video.addEventListener('loadedmetadata', handleProgress);
    
    return () => {
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('loadedmetadata', handleProgress);
    };
  }, [videoRef, handleProgress, currentVideo]);

  if (!currentVideo) return null;

  return (
    <div className="video-player-container">
      <video 
        ref={videoRef}
        src={currentVideo.url} 
        controls 
        autoPlay 
        playsInline
        preload="auto"
        className="main-video"
        onPlay={onPlay}
        onPause={onPause}
        onSeeked={onSeek}
        onError={onError}
      />
      <div className="video-info">
        <span>Viendo: {currentVideo.name}</span>
        {bufferProgress > 0 && (
          <span className="buffer-info"> | Buffer: {bufferProgress.toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
};

export default VideoPlayer;