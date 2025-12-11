import { useGoogleLogin } from '@react-oauth/google';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './App.css';

// Asegúrate de que coincida con tu puerto backend
const socket = io('http://localhost:3001');

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Estados de la Sala
  const [roomId, setRoomId] = useState("");
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  
  // Referencias para manejar el estado dentro de los sockets sin errores
  const videoRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const currentVideoRef = useRef(null); // TRUCO: Guardamos el video aquí también para leerlo en el socket

  // --- 1. LÓGICA DE SOCKETS ---
  useEffect(() => {
    
    // A) Cuando ALGUIEN MÁS entra a la sala
    socket.on('user_joined', () => {
      console.log("👋 Nuevo usuario detectado. Sincronizando...");
      
      // Si yo tengo un video cargado, se lo envío al nuevo
      if (currentVideoRef.current && videoRef.current) {
        socket.emit('sync_action', { 
          type: 'sync_full_state', // "Toma todo el estado actual"
          roomId: roomId, // Ojo: asegúrate que roomId esté disponible o usar useRef si falla
          videoData: currentVideoRef.current,
          currentTime: videoRef.current.currentTime,
          isPlaying: !videoRef.current.paused
        });
      }
    });

    // B) Recibir acciones
    socket.on('sync_action', (data) => {
      // Ignorar mis propias acciones si rebotaran (aunque el backend ya las filtra con socket.to)
      isRemoteUpdate.current = true;
      const video = videoRef.current;

      console.log("📩 Acción recibida:", data.type);

      switch (data.type) {
        case 'play':
          if(video) video.play().catch(e => console.log("Autoplay bloqueado:", e));
          break;
          
        case 'pause':
          if(video) video.pause();
          break;
          
        case 'seek':
          if (video && Math.abs(video.currentTime - data.currentTime) > 1) {
             video.currentTime = data.currentTime;
          }
          break;
          
        case 'change_video':
          // Cambio normal de video
          setCurrentVideo(data.videoData);
          currentVideoRef.current = data.videoData; // Actualizar ref
          break;

        case 'sync_full_state':
          // "Sync Inicial": Me acabo de unir y me mandaron el video que ya veían
          if (!currentVideoRef.current) { // Solo si no estoy viendo nada aún
             console.log("📥 Recibiendo estado inicial de la sala...");
             setCurrentVideo(data.videoData);
             currentVideoRef.current = data.videoData;
             
             // Esperamos un poquito a que React renderice el <video> para ajustar el tiempo
             setTimeout(() => {
               if(videoRef.current) {
                 videoRef.current.currentTime = data.currentTime;
                 if(data.isPlaying) videoRef.current.play().catch(e=>{});
               }
             }, 500);
          }
          break;
          
        default:
          break;
      }

      // Liberar el bloqueo después de un momento
      setTimeout(() => { isRemoteUpdate.current = false; }, 500);
    });

    return () => {
      socket.off('sync_action');
      socket.off('user_joined');
    };
  }, [roomId]); // Dependencia roomId para que el socket sepa en qué sala emitir

  // --- 2. EMISORES DE EVENTOS (Cuando tú tocas el video) ---
  
  const handlePlay = () => {
    if (!isRemoteUpdate.current && currentVideo) {
      socket.emit('sync_action', { type: 'play', roomId });
    }
  };

  const handlePause = () => {
    if (!isRemoteUpdate.current && currentVideo) {
      socket.emit('sync_action', { type: 'pause', roomId });
    }
  };

  const handleSeek = () => {
    if (!isRemoteUpdate.current && currentVideo && videoRef.current) {
      socket.emit('sync_action', { 
        type: 'seek', 
        roomId, 
        currentTime: videoRef.current.currentTime 
      });
    }
  };

  // --- 3. FUNCIONES GENERALES ---

  const login = useGoogleLogin({
    onSuccess: (response) => {
      setToken(response.access_token);
      fetchVideos(response.access_token);
      setUser({ name: "Usuario conectado" });
    },
    onError: (error) => console.log("Login fallo:", error),
    scope: "https://www.googleapis.com/auth/drive.readonly"
  });

  const logout = () => {
    setToken(null);
    setFiles([]);
    setUser(null);
    setJoinedRoom(false);
    setCurrentVideo(null);
    currentVideoRef.current = null;
  }

  const fetchVideos = async (accessToken) => {
    setLoading(true);
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: "mimeType contains 'video/' and trashed = false",
          fields: 'files(id, name, mimeType, size)',
          pageSize: 20 
        },
      });
      setFiles(response.data.files);
    } catch (error) { console.error(error); }
    setLoading(false);
  }

  const playVideo = (file) => {
    const streamUrl = `http://localhost:3001/stream/${file.id}?access_token=${token}`;
    const videoData = { ...file, url: streamUrl };
    
    // 1. Actualizo mi vista
    setCurrentVideo(videoData);
    currentVideoRef.current = videoData; // IMPORTANTE: Actualizar la referencia
    
    // 2. Aviso a la sala
    socket.emit('sync_action', { 
      type: 'change_video', 
      roomId, 
      videoData: videoData 
    });
  }

  const joinRoom = () => {
    if (roomId !== "") {
      socket.emit('join_room', roomId);
      setJoinedRoom(true);
    }
  };

  return (
    <div className="App">
      <h1 style={{textAlign: 'center', color: '#333'}}>🍿 Watch Party Drive</h1>

      {!token ? (
        <div style={{textAlign:'center', marginTop: '50px'}}>
          <button onClick={() => login()} style={{ padding: '15px', fontSize: '1.2rem', cursor: 'pointer', background: '#4285F4', color: 'white', border: 'none', borderRadius: '5px' }}>
            Iniciar sesión con Google
          </button>
        </div>
      ) : (
        <div style={{padding: '20px'}}>
          
          {/* SECCIÓN DE SALA */}
          {!joinedRoom ? (
             <div style={{textAlign: 'center', margin: '20px auto', maxWidth: '400px', border: '2px dashed #ccc', padding: '30px', borderRadius: '10px'}}>
                <h3>🏠 Unirse a una Sala</h3>
                <input 
                  type="text" 
                  placeholder="Nombre de Sala (Ej: CINE)" 
                  onChange={(event) => setRoomId(event.target.value)}
                  style={{padding: '10px', fontSize: '16px', marginRight: '10px', width: '60%'}}
                />
                <button onClick={joinRoom} style={{backgroundColor: '#26bd60ff', padding: '10px 20px', color: 'white', border: 'none', cursor: 'pointer'}}>Entrar</button>
             </div>
          ) : (
             <div style={{textAlign: 'center', marginBottom: '10px'}}>
                <span style={{background: '#d4edda', color: '#155724', padding: '5px 15px', borderRadius: '20px', fontWeight: 'bold'}}>
                   🟢 Sala: {roomId}
                </span>
             </div>
          )}

          {/* REPRODUCTOR */}
          {joinedRoom && currentVideo && (
            <div style={{ maxWidth: '900px', margin: '0 auto 30px auto', background: '#000', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
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
               <div style={{padding: '15px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <span style={{fontSize: '1.1rem'}}>🎬 Viendo: <strong>{currentVideo.name}</strong></span>
                  <button onClick={() => { setCurrentVideo(null); currentVideoRef.current = null; }} style={{background: '#dc3545', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer'}}>
                    Cerrar Video
                  </button>
               </div>
            </div>
          )}

          {/* LISTA DE VIDEOS */}
          {joinedRoom && (
            <div style={{maxWidth: '1000px', margin: '0 auto'}}>
              <h3 style={{borderBottom: '2px solid #eee', paddingBottom: '10px'}}>📂 Mis Videos de Drive</h3>
              {loading && <p>Cargando videos...</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', marginTop: '20px' }}>
                {files.map((file) => (
                  <div key={file.id} style={{border: '1px solid #ddd', padding: '15px', borderRadius: '8px', textAlign: 'center', background: 'white', boxShadow: '0 2px 5px rgba(0,0,0,0.05)'}}>
                    <div style={{fontSize: '3rem', marginBottom: '10px'}}>🎥</div>
                    <h4 style={{fontSize: '0.9rem', marginBottom: '15px', height: '40px', overflow: 'hidden'}}>{file.name}</h4>
                    <button onClick={() => playVideo(file)} style={{ backgroundColor: '#4285F4', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', width: '100%', cursor: 'pointer' }}>
                      Reproducir para todos
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div style={{textAlign: 'center', marginTop: '50px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
             <button onClick={logout} style={{ backgroundColor: '#6c757d', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>Cerrar sesión total</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App;