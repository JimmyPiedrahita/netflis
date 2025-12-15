import React, { useEffect } from 'react';

const VideoPlayer = ({ 
  videoRef, 
  currentVideo, 
  onPlay, 
  onPause, 
  onSeek 
}) => {

  // Efecto para debuggear eventos nativos del video
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const logEvent = (eventName, e) => {
        // Filtramos timeupdate porque spamea mucho
        if(eventName !== 'timeupdate') {
            console.log(`[VIDEO-DOM] Event: ${eventName} | Time: ${e.target.currentTime} | Buffered: ${e.target.buffered.length > 0 ? e.target.buffered.end(e.target.buffered.length-1) : 0}`);
        }
    };

    const events = ['loadstart', 'waiting', 'stalled', 'playing', 'pause', 'canplay', 'error'];
    
    events.forEach(ev => {
        videoElement.addEventListener(ev, (e) => logEvent(ev, e));
    });

    return () => {
        events.forEach(ev => {
            videoElement.removeEventListener(ev, (e) => logEvent(ev, e));
        });
    };
  }, [currentVideo, videoRef]);

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
      />
      <div className="video-info">
        <span>Viendo: {currentVideo.name}</span>
      </div>
    </div>
  );
};

export default VideoPlayer;