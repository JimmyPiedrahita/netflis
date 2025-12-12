import React from 'react';
import { useWatchParty } from './hooks/useWatchParty';
import Header from './components/Header';
import Login from './components/Login';
import RoomInfo from './components/RoomInfo';
import VideoPlayer from './components/VideoPlayer';
import VideoList from './components/VideoList';
import './App.css';

function App() {
  const {
    user,
    token,
    files,
    loading,
    roomId,
    joinedRoom,
    currentVideo,
    isHost,
    videoRef,
    handlePlay,
    handlePause,
    handleSeek,
    createRoomAndPlay,
    playVideo,
    handleLoginSuccess,
    logout,
    leaveRoom,
    participantCount
  } = useWatchParty();

  const handleVideoSelect = (file) => {
    if (joinedRoom) {
      playVideo(file);
    } else {
      createRoomAndPlay(file);
    }
  };

  return (
    <div className="App">
      <Header user={user} logout={logout} />
      
      <main className="main-content">
        {!token ? (
          <Login onSuccess={handleLoginSuccess} roomId={roomId} />
        ) : (
          <>
            {joinedRoom && <RoomInfo onLeave={leaveRoom} participantCount={participantCount} />}
            
            <VideoPlayer 
              videoRef={videoRef}
              currentVideo={currentVideo}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
            />
            
            <VideoList 
              files={files}
              loading={loading}
              joinedRoom={joinedRoom}
              isHost={isHost}
              onSelectVideo={handleVideoSelect}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
