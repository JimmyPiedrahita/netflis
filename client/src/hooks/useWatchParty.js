import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

const socket = io('http://localhost:3001');

export const useWatchParty = () => {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user_data');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem('access_token') || null;
  });

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [roomId, setRoomId] = useState(null);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [isHost, setIsHost] = useState(false);
  
  const videoRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const currentVideoRef = useRef(null);

  // --- LOGOUT Y INTERCEPTOR ---
  const logout = useCallback(() => {
    setToken(null);
    setFiles([]);
    setUser(null);
    setJoinedRoom(false);
    setCurrentVideo(null);
    currentVideoRef.current = null;
    setRoomId(null);
    window.history.pushState({}, document.title, window.location.pathname);
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_data');
  }, []);

  const leaveRoom = useCallback(() => {
    setJoinedRoom(false);
    setCurrentVideo(null);
    currentVideoRef.current = null;
    setRoomId(null);
    setIsHost(false);
    window.history.pushState({}, document.title, window.location.pathname);
    // Opcional: emitir evento de salir de sala si el backend lo maneja
    // socket.emit('leave_room', roomId); 
  }, [roomId]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response && error.response.status === 401) logout(); 
        return Promise.reject(error);
      }
    );

    return () => axios.interceptors.response.eject(interceptor);
  }, [logout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomUrl = params.get('room');
    if (roomUrl) setRoomId(roomUrl);
  }, []);

  const fetchVideos = useCallback(async (accessToken) => {
    setLoading(true);
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { q: "mimeType contains 'video/' and trashed = false", fields: 'files(id, name, mimeType, size)', pageSize: 20 },
      });
      setFiles(response.data.files);
    } catch (error) { console.error(error); }
    setLoading(false);
  }, []);

  const joinRoomExisting = useCallback((id) => {
    socket.emit('join_room', id);
    setJoinedRoom(true);
    setIsHost(false);
  }, []);

  useEffect(() => {
    if (token && files.length === 0) {
      fetchVideos(token);
      const params = new URLSearchParams(window.location.search);
      const roomUrl = params.get('room');
      if (roomUrl && !joinedRoom) joinRoomExisting(roomUrl);
    }
  }, [token, files.length, joinedRoom, fetchVideos, joinRoomExisting]);

  // --- LÓGICA DE SOCKETS ---
  useEffect(() => {
    socket.on('user_joined', () => {
      if (currentVideoRef.current && videoRef.current) {
        socket.emit('sync_action', { 
          type: 'sync_full_state',
          roomId: roomId, 
          videoData: currentVideoRef.current,
          currentTime: videoRef.current.currentTime,
          isPlaying: !videoRef.current.paused
        });
      }
    });

    socket.on('sync_action', (data) => {
      isRemoteUpdate.current = true;
      const video = videoRef.current;

      switch (data.type) {
        case 'play':
          if(video) {
             if (Math.abs(video.currentTime - data.currentTime) > 0.5) {
                 video.currentTime = data.currentTime; 
             }
             video.play().catch(e=>{});
          }
          break; 
          
        case 'pause': 
          if(video) {
            video.pause();
            if (Math.abs(video.currentTime - data.currentTime) > 0.5) {
                video.currentTime = data.currentTime;
            }
          }
          break;  
          
        case 'seek': 
          if(video) {
             video.currentTime = data.currentTime;
             if (data.isPlaying) {
                 video.play().catch(e=>{});
             } else {
                 video.pause();
             }
          }
          break;   
          
        case 'change_video':
          setCurrentVideo(data.videoData);
          currentVideoRef.current = data.videoData; 
          break;
          
        case 'sync_full_state':
          if (!currentVideoRef.current) {
             setCurrentVideo(data.videoData);
             currentVideoRef.current = data.videoData;
             setTimeout(() => {
               if(videoRef.current) {
                 videoRef.current.currentTime = data.currentTime;
                 if(data.isPlaying) videoRef.current.play().catch(e=>{});
               }
             }, 500);
          }
          break;   
        default: break;
      }
      setTimeout(() => { isRemoteUpdate.current = false; }, 500);
    });

    return () => {
      socket.off('sync_action');
      socket.off('user_joined');
    };
  }, [roomId]); 

  // --- ACCIONES ---
  const handlePlay = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      socket.emit('sync_action', { 
        type: 'play', 
        roomId,
        currentTime: videoRef.current.currentTime 
      });
    }
  };

  const handlePause = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      socket.emit('sync_action', { 
        type: 'pause', 
        roomId,
        currentTime: videoRef.current.currentTime
      });
    }
  };

  const handleSeek = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      const isPlaying = !videoRef.current.paused;
      socket.emit('sync_action', { 
        type: 'seek', 
        roomId, 
        currentTime: videoRef.current.currentTime,
        isPlaying: isPlaying 
      });
    }
  };

  const playVideo = (file, activeRoomId) => {
    const targetRoom = activeRoomId || roomId;
    const streamUrl = `http://localhost:3001/stream/${file.id}?access_token=${token}`;
    const videoData = { ...file, url: streamUrl };
    setCurrentVideo(videoData);
    currentVideoRef.current = videoData; 
    socket.emit('sync_action', { type: 'change_video', roomId: targetRoom, videoData: videoData });
  };

  const createRoomAndPlay = (file) => {
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    socket.emit('join_room', newRoomId);
    setJoinedRoom(true);
    setIsHost(true);
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + newRoomId;
    window.history.pushState({path:newUrl},'',newUrl);
    playVideo(file, newRoomId);
  };

  const handleLoginSuccess = (response) => {
    const newToken = response.access_token;
    localStorage.setItem('access_token', newToken);
    localStorage.setItem('user_data', JSON.stringify({ name: "Usuario Conectado" }));
    setToken(newToken);
    setUser({ name: "Usuario Conectado" });
    fetchVideos(newToken);
    if (roomId) joinRoomExisting(roomId);
  };

  return {
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
    leaveRoom
  };
};
