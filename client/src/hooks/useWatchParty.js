import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

const socket = io(import.meta.env.VITE_API_URL);

export const useWatchParty = () => {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user_data');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem('access_token') || null;
  });

  const refreshTokenRef = useRef(localStorage.getItem('refresh_token'));

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [roomId, setRoomId] = useState(null);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  
  const videoRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const currentVideoRef = useRef(null);

  // --- LOGOUT Y INTERCEPTOR ---
  const logout = useCallback(() => {
    console.log("[HOOK] Logout ejecutado");
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
    console.log("[HOOK] Abandonando sala:", roomId);
    setJoinedRoom(false);
    setCurrentVideo(null);
    currentVideoRef.current = null;
    setRoomId(null);
    setIsHost(false);
    setParticipantCount(1);
    window.history.pushState({}, document.title, window.location.pathname);
    if (roomId) socket.emit('leave_room', roomId); 
  }, [roomId]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          console.warn("[HOOK] 401 detectado, intentando refresh token...");
          originalRequest._retry = true;
          try {
            const storedRefreshToken = localStorage.getItem('refresh_token');
            if (!storedRefreshToken) throw new Error('No refresh token');

            const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
                refreshToken: storedRefreshToken
            });

            const newAccessToken = res.data.access_token;
            console.log("[HOOK] Access token renovado exitosamente");
            localStorage.setItem('access_token', newAccessToken);
            setToken(newAccessToken);
            originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
            return axios(originalRequest);
          } catch (refreshError) {
            console.error("[HOOK] Fallo el refresh token, haciendo logout", refreshError);
            logout();
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [logout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomUrl = params.get('room');
    if (roomUrl) {
        console.log("[HOOK] Room detectada en URL:", roomUrl);
        setRoomId(roomUrl);
    }
  }, []);

  const fetchVideos = useCallback(async (accessToken) => {
    console.log("[HOOK] Obteniendo lista de videos...");
    setLoading(true);
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { q: "mimeType contains 'video/' and trashed = false", fields: 'files(id, name, mimeType, size)', pageSize: 20 },
      });
      console.log(`[HOOK] ${response.data.files.length} videos obtenidos.`);
      setFiles(response.data.files);
    } catch (error) { console.error("[HOOK] Error fetching videos:", error); }
    setLoading(false);
  }, []);

  const joinRoomExisting = useCallback((id) => {
    console.log("[HOOK] Uniendo a sala existente:", id);
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
    socket.on('connect', () => console.log("[SOCKET] Conectado al servidor Socket.io"));
    
    socket.on('room_users_update', (data) => {
      console.log("[SOCKET] Usuarios en sala actualizados:", data.count);
      setParticipantCount(data.count);
    });

    socket.on('user_joined', () => {
      console.log("[SOCKET] Nuevo usuario entró. Enviando sync_full_state...");
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
      console.log(`[SOCKET-IN] Evento recibido: ${data.type} | Time: ${data.currentTime}`);
      isRemoteUpdate.current = true;
      const video = videoRef.current;

      switch (data.type) {
        case 'play':
          if(video) {
             if (Math.abs(video.currentTime - data.currentTime) > 0.5) {
                 console.log("[SYNC] Ajustando tiempo por desincronización > 0.5s");
                 video.currentTime = data.currentTime; 
             }
             video.play().catch(e=>{ console.warn("[SYNC] Error al intentar play remoto:", e) });
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
             console.log("[SYNC] Seek remoto ejecutado");
             video.currentTime = data.currentTime;
             if (data.isPlaying) {
                 video.play().catch(e=>{});
             } else {
                 video.pause();
             }
          }
          break;   
          
        case 'change_video':
          console.log("[SYNC] Cambio de video remoto:", data.videoData.name);
          setCurrentVideo(data.videoData);
          currentVideoRef.current = data.videoData; 
          break;
          
        case 'sync_full_state':
          if (!currentVideoRef.current) {
             console.log("[SYNC] Estado inicial recibido.");
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
      // Reducido el tiempo de bloqueo remoto para evitar bloqueos
      setTimeout(() => { isRemoteUpdate.current = false; }, 500);
    });

    return () => {
      socket.off('connect');
      socket.off('sync_action');
      socket.off('user_joined');
      socket.off('room_users_update');
    };
  }, [roomId]); 

  // --- ACCIONES ---
  const handlePlay = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      console.log("[USER] Play local -> Emitiendo");
      socket.emit('sync_action', { 
        type: 'play', 
        roomId,
        currentTime: videoRef.current.currentTime 
      });
    } else {
        console.log("[USER] Play ignorado (Remote Update activo)");
    }
  };

  const handlePause = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      console.log("[USER] Pause local -> Emitiendo");
      socket.emit('sync_action', { 
        type: 'pause', 
        roomId,
        currentTime: videoRef.current.currentTime
      });
    }
  };

  const handleSeek = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      console.log("[USER] Seek local -> Emitiendo");
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
    console.log(`[ACTION] Reproduciendo video: ${file.name} en sala ${targetRoom}`);
    const streamUrl = `${import.meta.env.VITE_API_URL}/stream/${file.id}?access_token=${token}`;
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

  const handleLoginSuccess = async (response) => {
    console.log("[LOGIN] Login exitoso con Google, procesando...");
    try {
        const { code } = response;
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/google`, { code });
        const { access_token, refresh_token } = res.data;
        
        localStorage.setItem('access_token', access_token);
        setToken(access_token);
        
        if (refresh_token) {
            localStorage.setItem('refresh_token', refresh_token);
            refreshTokenRef.current = refresh_token;
        }

        const userData = { name: "Usuario Conectado" };
        localStorage.setItem('user_data', JSON.stringify(userData));
        setUser(userData);
        
        fetchVideos(access_token);
        if (roomId) joinRoomExisting(roomId);

    } catch (error) {
        console.error("[LOGIN] Error en el intercambio de tokens:", error);
    }
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
    leaveRoom,
    participantCount
  };
};