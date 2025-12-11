require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();

//Configuracion de CORS para permitir solicitudes desde el frontend
app.use(cors({
    origin: 'http://localhost:5173', // direccion de frontend
    methods: ['GET', 'POST']
}));
app.use(express.json());

const server = http.createServer(app);

//Configuracion de Socket.io (Sincronizacion)
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:5173',
        methods: ['GET', 'POST']
    }
});

// -- RUTAS -- 

//Ruta de prueba
app.get('/', (req, res) => {
    res.send('Servidor funcionando correctamente');
});

//Ruta de streaming de video desde Google Drive
app.get('/stream/:fileId', async (req, res) => {
    let { fileId } = req.params;
    // Eliminar extensión .mp4 si existe para que ReactPlayer detecte el tipo de archivo
    if (fileId.endsWith('.mp4')) {
        fileId = fileId.replace('.mp4', '');
    }
    const { access_token } = req.query;

    if (!access_token) {
        return res.status(401).send('Falta el Access token');
    }

    try {
        console.log(`🎥 Iniciando Stream para: ${fileId}`);

        // Headers que enviaremos a Google
        const headers = {
            Authorization: `Bearer ${access_token}`,
        };

        // Si el navegador (ReactPlayer) pide un minuto específico, se lo pasamos a Google
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
            console.log(`⏩ Saltando a: ${req.headers.range}`);
        }

        // Petición directa a Google como flujo de datos (Stream)
        const driveResponse = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            headers: headers,
            responseType: 'stream', // CLAVE: Recibir como tubería
            validateStatus: (status) => status < 500 // No lanzar error en 4xx para poder leer el body si es json
        });

        console.log(`Google Response Status: ${driveResponse.status}`);
        console.log(`Google Content-Type: ${driveResponse.headers['content-type']}`);
        console.log(`Google Content-Length: ${driveResponse.headers['content-length']}`);

        // Si Google devuelve un error (ej: 403), probablemente el body sea un JSON con el error
        if (driveResponse.status >= 400) {
             console.error("Error desde Google Drive (Stream):", driveResponse.status);
             // Podríamos intentar leer el stream para ver el error, pero por ahora solo devolvemos el status
             return res.sendStatus(driveResponse.status);
        }

        // Copiamos los headers de respuesta de Google hacia tu navegador
        res.set('Content-Range', driveResponse.headers['content-range']);
        res.set('Accept-Ranges', driveResponse.headers['accept-ranges']);
        res.set('Content-Length', driveResponse.headers['content-length']);


        res.set('Content-Type', 'video/mp4');
        
        // Headers para evitar problemas de CORS/COOP y permitir reproducción cross-origin
        res.set('Access-Control-Allow-Origin', '*');

        // Respondemos con el mismo status que Google (generalmente 206 Partial Content)
        res.status(driveResponse.status);

        // Conectamos la tubería: Google -> Servidor -> Navegador
        driveResponse.data.pipe(res);

    } catch (error) {
        console.error('❌ Error en el stream:', error.message);
        if (error.response) {
            console.error('Detalle error Google:', error.response.status);
            console.error('Headers:', error.response.headers);
        }
        if (!res.headersSent) {
            res.sendStatus(500);
        }
    }
});

// -- SOCKET.IO --
io.on('connection', (socket) => {
    console.log('Usuario conectado: ' + socket.id);

    socket.on('disconnect', () => {
        console.log('Usuario desconectado: ' + socket.id);
    });
});

//Iniciar el servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
