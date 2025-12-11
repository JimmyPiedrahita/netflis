import { useGoogleLogin } from '@react-oauth/google';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid'; // Importamos el generador de IDs
import './App.css';

// Asegúrate de que coincida con tu puerto backend
const socket = io('http://localhost:3001');

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Estados de la Sala
  const [roomId, setRoomId] = useState(null); // Ahora empieza como null
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [isHost, setIsHost] = useState(false); // Para saber si yo cree la sala
  
  const videoRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const currentVideoRef = useRef(null);

  // --- 0. LÓGICA DE URL (NUEVO) ---
  useEffect(() => {
    // Al cargar la página, miramos si hay un "?room=..." en la URL
    const params = new URLSearchParams(window.location.search);
    const roomUrl = params.get('room');

    if (roomUrl) {
      // Si hay room en la URL, es un INVITADO
      console.log("🔗 Detectado link de invitación para sala:", roomUrl);
      setRoomId(roomUrl);
    }
    // Si no hay room, es un ANFITRION (aún no ha creado sala)
  }, []);

  // --- 1. LÓGICA DE SOCKETS ---
  useEffect(() => {
    socket.on('user_joined', () => {
      console.log("👋 Nuevo usuario detectado. Sincronizando...");
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
          if(video) video.play().catch(e=>{});
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

  // --- 2. LOGIN Y AUTO-JOIN ---
  const login = useGoogleLogin({
    onSuccess: (response) => {
      setToken(response.access_token);
      fetchVideos(response.access_token);
      setUser({ name: "Usuario conectado" });

      // MAGIA: Si ya había un roomId en la URL (porque soy invitado), entro de una vez
      if (roomId) {
        joinRoomExisting(roomId);
      }
    },
    onError: (error) => console.log("Login fallo:", error),
    scope: "https://www.googleapis.com/auth/drive.readonly"
  });

  // Función para unirse a una sala que ya existe (Invitado)
  const joinRoomExisting = (id) => {
    socket.emit('join_room', id);
    setJoinedRoom(true);
    setIsHost(false);
  };

  // Función para crear sala nueva (Anfitrión) al seleccionar video
  const createRoomAndPlay = (file) => {
    // 1. Generar ID único
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    
    // 2. Unirse al socket
    socket.emit('join_room', newRoomId);
    setJoinedRoom(true);
    setIsHost(true);

    // 3. Actualizar la URL del navegador sin recargar la página
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + newRoomId;
    window.history.pushState({path:newUrl},'',newUrl);

    // 4. Reproducir el video
    playVideo(file, newRoomId);
  };

  // --- 3. REPRODUCTOR Y UTILIDADES ---
  
  const playVideo = (file, activeRoomId) => {
    // Usamos el roomId que le pasamos O el del estado
    const targetRoom = activeRoomId || roomId;
    
    const streamUrl = `http://localhost:3001/stream/${file.id}?access_token=${token}`;
    const videoData = { ...file, url: streamUrl };
    
    setCurrentVideo(videoData);
    currentVideoRef.current = videoData; 
    
    socket.emit('sync_action', { 
      type: 'change_video', 
      roomId: targetRoom, 
      videoData: videoData 
    });
  }

  // Copiar link al portapapeles
  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert("¡Enlace copiado! Envíaselo a tu amigo.");
  };

  // Eventos manuales del video
  const handlePlay = () => !isRemoteUpdate.current && socket.emit('sync_action', { type: 'play', roomId });
  const handlePause = () => !isRemoteUpdate.current && socket.emit('sync_action', { type: 'pause', roomId });
  const handleSeek = () => !isRemoteUpdate.current && videoRef.current && socket.emit('sync_action', { type: 'seek', roomId, currentTime: videoRef.current.currentTime });

  // Otros
  const logout = () => {
    setToken(null);
    setFiles([]);
    setUser(null);
    setJoinedRoom(false);
    setCurrentVideo(null);
    currentVideoRef.current = null;
    // Limpiar URL al salir
    window.history.pushState({}, document.title, window.location.pathname);
    setRoomId(null);
  }

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
          {/* Mensaje personalizado si vienes invitado */}
          {roomId && <p style={{color: '#e50914', fontWeight: 'bold'}}>Has sido invitado a una sala. Inicia sesión para entrar.</p>}
          
          <button onClick={() => login()} style={{ padding: '15px', fontSize: '1.2rem', cursor: 'pointer', background: '#4285F4', color: 'white', border: 'none', borderRadius: '5px' }}>
            Iniciar sesión con Google
          </button>
        </div>
      ) : (
        <div style={{padding: '20px'}}>
          
          {/* HEADER DE LA SALA */}
          {joinedRoom && (
             <div style={{textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#f8f9fa', borderRadius: '10px'}}>
                <span style={{marginRight: '10px'}}>🟢 Sala Activa</span>
                <button onClick={copyLink} style={{background: '#28a745', color: 'white', border: 'none', padding: '5px 15px', borderRadius: '5px', cursor: 'pointer'}}>
                  🔗 Copiar Enlace para invitar
                </button>
             </div>
          )}

          {/* REPRODUCTOR */}
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

          {/* LISTA DE VIDEOS (Solo visible para el Anfitrión o si no hay video puesto) */}
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
                    
                    {/* LOGICA DEL BOTON: Si ya tengo sala, solo cambio video. Si no, creo sala. */}
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

          {/* Si soy invitado y ya hay video, no muestro mi lista de archivos para no confundir, o la muestro abajo */}
          {joinedRoom && !isHost && (
             <p style={{textAlign:'center', color: '#888', marginTop: '50px'}}>
               Estás conectado como invitado. El anfitrión controla qué video se ve.
             </p>
          )}
          
          <div style={{textAlign: 'center', marginTop: '50px'}}>
             <button onClick={logout} style={{ backgroundColor: '#6c757d', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>Salir</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App;