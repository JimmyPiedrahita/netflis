import { useGoogleLogin } from '@react-oauth/google';
import { useState } from 'react';
import axios from 'axios';
import './App.css'

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);

  //Configuracion del login
  const login = useGoogleLogin({
    onSuccess: (response) => {
      setToken(response.access_token);

      //Usar el token para obtener los videos
      fetchVideos(response.access_token);

      //Datos del usuario
      setUser({ name: "Usuario conectado" });
    },
    onError: (error) => console.log("Login fallo:", error),
    // Pedir permiso solo para ver archivos (readonly)
    scope: "https://www.googleapis.com/auth/drive.readonly"
  });

  const logout = () => {
    setToken(null);
    setFiles([]);
    setUser(null);
  }

  // Consultar la API de Google Drive
  const fetchVideos = async (accessToken) => {
    setLoading(true);
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          // FILTRO: Solo videos y que no estén en la papelera
          q: "mimeType contains 'video/' and trashed = false",
          // Pedimos solo los campos que nos interesan
          fields: 'files(id, name, mimeType, webViewLink, size)',
          pageSize: 20 // Traer los primeros 20 para probar
        },
      });
      setFiles(response.data.files);

    } catch (error) {
      console.error("Error al obtener los videos de Google Drive:", error);
    }
    setLoading(false);
  }

  //Selecciona el video y construye la URL de streaming
  const playVideo = (file) => {
    const streamUrl = `http://localhost:3001/stream/${file.id}?access_token=${token}`;
    console.log("Reproduciendo URL:", streamUrl);
    setCurrentVideo({ ...file, url: streamUrl });
  }

  return (
    <>
      {!token ? (
        <div>
          <button 
            onClick={() => login()}
            style={{ backgroundColor: '#4285F4' }}
          >
            Iniciar sesión con Google
          </button>
        </div>

      ) : (
        <div>
          {/* --- REPRODUCTOR DE VIDEO NATIVO --- */}
          {currentVideo && (
            <div>
               
               {/* Usamos la etiqueta video nativa para depurar mejor */}
               <video 
                  src={currentVideo.url} 
                  controls 
                  autoPlay 
                  width="100%" 
                  height="500px"
                  style={{ backgroundColor: 'black' }}
               >
                 Tu navegador no soporta el elemento de video.
               </video>

               <button onClick={() => setCurrentVideo(null)} style={{margin: '10px', padding: '10px'}}>
                 Cerrar
               </button>
            </div>
          )}
          <div>
            <button onClick={logout} style={{ backgroundColor: '#d84b28ff' }}>Cerrar sesión</button>
          </div>

          {loading && <p>Cargando...</p>}

          {!loading && files.length === 0 && (
            <p>No hay videos</p>
          )}

          <div>
            {files.map((file) => (
              <div key={file.id}>
                <h3>
                  {file.name}
                </h3>
                <button
                  onClick={() => playVideo(file)}
                  style={{ backgroundColor: '#26bd60ff' }}
                >
                  Seleccionar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default App
