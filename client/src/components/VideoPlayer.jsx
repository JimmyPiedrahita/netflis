import React, { useEffect } from 'react';

const VideoPlayer = ({ 
  videoRef, 
  currentVideo, 
  onPlay, 
  onPause, 
  onSeek,
  onError // Recibimos la prop
}) => {

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const lockOrientation = async () => {
      try {
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape');
        }
      } catch (error) {
        console.log('Orientation lock failed or not supported:', error);
      }
    };

    const unlockOrientation = () => {
      try {
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
        }
      } catch (error) {
        console.log('Orientation unlock failed:', error);
      }
    };

    const handleFullScreenChange = () => {
      const isFullScreen = document.fullscreenElement || 
                           document.webkitFullscreenElement || 
                           document.mozFullScreenElement || 
                           document.msFullscreenElement ||
                           video.webkitDisplayingFullscreen;

      if (isFullScreen) {
        lockOrientation();
      } else {
        unlockOrientation();
      }
    };

    // Event listeners for various browsers
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullScreenChange);
    document.addEventListener('mozfullscreenchange', handleFullScreenChange);
    document.addEventListener('msfullscreenchange', handleFullScreenChange);
    
    // iOS specific events on the video element
    video.addEventListener('webkitbeginfullscreen', lockOrientation);
    video.addEventListener('webkitendfullscreen', unlockOrientation);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullScreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullScreenChange);
      document.removeEventListener('msfullscreenchange', handleFullScreenChange);
      
      video.removeEventListener('webkitbeginfullscreen', lockOrientation);
      video.removeEventListener('webkitendfullscreen', unlockOrientation);
    };
  }, [videoRef]);

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
        onError={onError} // Conectamos el error
      />
      <div className="video-info">
        <span>Viendo: {currentVideo.name}</span>
      </div>
    </div>
  );
};

export default VideoPlayer;