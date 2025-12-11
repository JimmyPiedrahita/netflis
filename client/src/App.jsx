import { useGoogleLogin } from '@react-oauth/google';
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

const socket = io('http://localhost:3001');

function App() {
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

  useEffect(() => {
    if (token && files.length === 0) {
      fetchVideos(token);
      const params = new URLSearchParams(window.location.search);
      const roomUrl = params.get('room');
      if (roomUrl && !joinedRoom) joinRoomExisting(roomUrl);
    }
  }, [token]);

  // --- 1. LÓGICA DE SOCKETS (CORREGIDA PARA SEEK) ---
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
             // 1. Saltamos al tiempo nuevo
             video.currentTime = data.currentTime;
             
             // 2. VERIFICAMOS EL ESTADO QUE ENVIÓ EL EMISOR
             // Si el que adelantó estaba reproduciendo, nosotros también
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


  // --- 2. EMISORES DE EVENTOS ---

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
      // ⚡ CORRECCIÓN AQUÍ:
      // Enviamos no solo el tiempo, sino si el video está pausado o no
      // "paused" es true si está quieto. Queremos saber isPlaying.
      const isPlaying = !videoRef.current.paused;
      
      socket.emit('sync_action', { 
        type: 'seek', 
        roomId, 
        currentTime: videoRef.current.currentTime,
        isPlaying: isPlaying // ⚡ Enviamos el estado futuro deseado
      });
    }
  };

  // --- RESTO ---
  const login = useGoogleLogin({
    onSuccess: (response) => {
      const newToken = response.access_token;
      localStorage.setItem('access_token', newToken);
      localStorage.setItem('user_data', JSON.stringify({ name: "Usuario Conectado" }));
      setToken(newToken);
      setUser({ name: "Usuario Conectado" });
      fetchVideos(newToken);
      if (roomId) joinRoomExisting(roomId);
    },
    onError: (error) => console.log("Login fallo:", error),
    scope: "https://www.googleapis.com/auth/drive.readonly"
  });

  const joinRoomExisting = (id) => {
    socket.emit('join_room', id);
    setJoinedRoom(true);
    setIsHost(false);
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

  const playVideo = (file, activeRoomId) => {
    const targetRoom = activeRoomId || roomId;
    const streamUrl = `http://localhost:3001/stream/${file.id}?access_token=${token}`;
    const videoData = { ...file, url: streamUrl };
    setCurrentVideo(videoData);
    currentVideoRef.current = videoData; 
    socket.emit('sync_action', { type: 'change_video', roomId: targetRoom, videoData: videoData });
  }

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert("¡Enlace copiado!");
  };

  const fetchVideos = async (accessToken) => {
    setLoading(true);
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { q: "mimeType contains 'video/' and trashed = false", fields: 'files(id, name, mimeType, size)', pageSize: 20 },
      });
      setFiles(response.data.files);
    } catch (error) { console.error(error); }
    setLoading(false);
  }

  return (
    <div className="App">
      <h1 style={{textAlign: 'center', color: '#333'}}>🍿 Watch Party Drive</h1>
      {!token ? (
        <div style={{textAlign:'center', marginTop: '50px'}}>
          {roomId && <p style={{color: '#e50914', fontWeight: 'bold'}}>Has sido invitado a una sala. Inicia sesión para entrar.</p>}
          <button onClick={() => login()} style={{ padding: '15px', fontSize: '1.2rem', cursor: 'pointer', background: '#4285F4', color: 'white', border: 'none', borderRadius: '5px' }}>
            Iniciar sesión con Google
          </button>
        </div>
      ) : (
        <div style={{padding: '20px'}}>
          {joinedRoom && (
             <div style={{textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#f8f9fa', borderRadius: '10px'}}>
                <span style={{marginRight: '10px'}}>🟢 Sala Activa</span>
                <button onClick={copyLink} style={{background: '#28a745', color: 'white', border: 'none', padding: '5px 15px', borderRadius: '5px', cursor: 'pointer'}}>
                  🔗 Copiar Enlace
                </button>
             </div>
          )}
          {joinedRoom && currentVideo && (
            <div style={{ maxWidth: '900px', margin: '0 auto 30px auto', background: '#000', borderRadius: '10px', overflow: 'hidden' }}>
               <video 
                  ref={videoRef}
                  src={currentVideo.url} 
                  controls 
                  autoPlay 
                  width="100%" 
                  height="500px"
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onSeeked={handleSeek}
                  style={{ backgroundColor: 'black', display: 'block' }}
               />
               <div style={{padding: '15px', color: 'white'}}>
                  <span style={{fontSize: '1.1rem'}}>🎬 Viendo: <strong>{currentVideo.name}</strong></span>
               </div>
            </div>
          )}
          {(!joinedRoom || isHost) && (
            <div style={{maxWidth: '1000px', margin: '0 auto'}}>
              <h3 style={{borderBottom: '2px solid #eee', paddingBottom: '10px'}}>
                {joinedRoom ? "Cambiar Video" : "Selecciona un video para empezar"}
              </h3>
              {loading && <p>Cargando videos...</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '20px' }}>
                {files.map((file) => (
                  <div key={file.id} style={{border: '1px solid #ddd', padding: '15px', borderRadius: '8px', textAlign: 'center', background: 'white'}}>
                    <div style={{fontSize: '3rem', marginBottom: '10px'}}>🎥</div>
                    <h4 style={{fontSize: '0.9rem', marginBottom: '15px', height: '40px', overflow: 'hidden'}}>{file.name}</h4>
                    <button 
                      onClick={() => joinedRoom ? playVideo(file) : createRoomAndPlay(file)} 
                      style={{ backgroundColor: '#4285F4', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', width: '100%', cursor: 'pointer' }}
                    >
                      {joinedRoom ? "Ver este" : "Crear Sala y Ver"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {joinedRoom && !isHost && (
             <p style={{textAlign:'center', color: '#888', marginTop: '50px'}}>El anfitrión controla el video.</p>
          )}
          <div style={{textAlign: 'center', marginTop: '50px'}}>
             <button onClick={logout} style={{ backgroundColor: '#6c757d', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>Cerrar sesión total</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App;