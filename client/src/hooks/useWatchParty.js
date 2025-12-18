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

  const [tokenExpiry, setTokenExpiry] = useState(() => {
    return localStorage.getItem('token_expiry') || null;
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
  const retryCount = useRef(0);

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
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_data');
    localStorage.removeItem('token_expiry');
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

            const { access_token, expiry_date } = res.data;
            console.log("[HOOK] Access token renovado exitosamente (Interceptor)");
            
            localStorage.setItem('access_token', access_token);
            setToken(access_token);
            if (expiry_date) {
                localStorage.setItem('token_expiry', expiry_date);
                setTokenExpiry(expiry_date);
            }
            
            originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
            return axios(originalRequest);
          } catch (refreshError) {
            console.error("[HOOK] Fallo el refresh token, haciendo logout", refreshError.message);
            logout();
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [logout]);


  // Rutina para renovar token proactivamente
  const refreshTokenRoutine = useCallback(async () => {
    try {
        const storedRefreshToken = localStorage.getItem('refresh_token');
        if (!storedRefreshToken) return;

        console.log("[SILENT-REFRESH] Iniciando renovación proactiva...");
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
            refreshToken: storedRefreshToken
        });

        const { access_token, expiry_date } = res.data;
        
        console.log("[SILENT-REFRESH] Token renovado sin cortes.");
        // Actualizamos LocalStorage (para llamadas API)
        localStorage.setItem('access_token', access_token);
        setToken(access_token);

        // Actualizamos Expiración
        if (expiry_date) {
            localStorage.setItem('token_expiry', expiry_date);
            setTokenExpiry(expiry_date);
        }
    } catch (error) {
        console.error("[SILENT-REFRESH] Error:", error.message);
    }
  }, []);

  // Efecto para vigilar la expiración y activar la renovación
  useEffect(() => {
      if (!tokenExpiry || !token) return;

      const now = Date.now();
      const timeLeft = tokenExpiry - now;
      const timeUntilRefresh = timeLeft - 120000; // Renovar 2 minutos antes

      if (timeUntilRefresh <= 0) {
          // Si ya estamos sobre la hora, renovar ya
          refreshTokenRoutine();
      } else {
          console.log(`[SILENT-REFRESH] Renovación programada en ${(timeUntilRefresh/1000).toFixed(0)}s`);
          const timer = setTimeout(refreshTokenRoutine, timeUntilRefresh);
          return () => clearTimeout(timer);
      }
  }, [tokenExpiry, token, refreshTokenRoutine]);

  // --- MANEJO DE ERROR DE VIDEO (RECUPERACIÓN) ---
  const handleVideoError = useCallback(() => {
      console.error("[VIDEO-ERROR] Error en reproducción. Intentando recuperar...");
      
      if (retryCount.current > 3) {
          console.error("[VIDEO-ERROR] Demasiados intentos fallidos.");
          return;
      }
      retryCount.current += 1;

      console.log("[VIDEO-ERROR] Forzando verificación de token...");
      axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${token}` },
        params: { pageSize: 1 } 
      }).catch(err => {
          console.log("Error en petición de recuperación:", err.message);
      });
      
      setTimeout(() => { retryCount.current = 0; }, 10000);

  }, [token]);

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
    } catch (error) { console.error("[HOOK] Error fetching videos:", error.message); }
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
    socket.on('room_users_update', (data) => {
      setParticipantCount(data.count);
    });

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
          if (!currentVideoRef.current || currentVideoRef.current.id !== data.videoData.id) {
              console.log("[SYNC] Cambiando video remoto");
              setCurrentVideo(data.videoData);
              currentVideoRef.current = data.videoData; 
          }
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
      socket.off('room_users_update');
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
    if (document.visibilityState === 'hidden') return;

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
    const streamUrl = `${import.meta.env.VITE_API_URL}/stream/${file.id}`;
    
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
    try {
        const { code } = response;
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/google`, { code });
        
        const { access_token, refresh_token, expiry_date } = res.data;
        
        localStorage.setItem('access_token', access_token);
        setToken(access_token);
        
        if (refresh_token) {
            localStorage.setItem('refresh_token', refresh_token);
            refreshTokenRef.current = refresh_token;
        }

        if (expiry_date) {
            localStorage.setItem('token_expiry', expiry_date);
            setTokenExpiry(expiry_date);
        }

        const userData = { name: "Usuario Conectado" };
        localStorage.setItem('user_data', JSON.stringify(userData));
        setUser(userData);
        
        fetchVideos(access_token);
        if (roomId) joinRoomExisting(roomId);

    } catch (error) {
        console.error("Error en el intercambio de tokens:", error.message);
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
    participantCount,
    handleVideoError
  };
};