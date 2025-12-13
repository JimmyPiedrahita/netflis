require('dotenv').config();
const { google } = require('googleapis');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();

const allowedOrigins = [
    'https://netflis123.web.app',      // Frontend Producción
    'https://netflis.practicas.me',    // Backend Producción
    'http://localhost:5173',           // Frontend Local
    'http://localhost:3001'            // Backend Local
];

// Configuración del Cliente OAuth2
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'postmessage'
);

//Configuracion de CORS para Express (API REST)
app.use(cors({
    origin: allowedOrigins, // direccion de frontend
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

const server = http.createServer(app);

//Configuracion de Socket.io (Sincronizacion)
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// -- RUTAS -- 

//Ruta de streaming de video desde Google Drive
app.get('/stream/:fileId', async (req, res) => {
    let { fileId } = req.params;
    const { access_token } = req.query;

    if (!fileId) {
        return res.status(400).send('Falta el fileId');
    }
    
    if (!access_token) {
        return res.status(401).send('Falta el Access token');
    }

    try {
        // Headers que enviaremos a Google
        const headers = {
            Authorization: `Bearer ${access_token}`,
        };

        // Si el navegador (ReactPlayer) pide un minuto específico, se lo pasamos a Google
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        // Petición directa a Google como flujo de datos (Stream)
        const driveResponse = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            headers: headers,
            responseType: 'stream', // CLAVE: Recibir como tubería
            validateStatus: (status) => status < 500 // No lanzar error en 4xx para poder leer el body si es json
        });

        // Manejo de errores desde Google Drive
        if (driveResponse.status >= 400) {
             console.error("Error desde Google Drive (Stream):", driveResponse.status);
             // Devolvemos el mismo error al cliente
             return res.sendStatus(driveResponse.status);
        }

        // Copiamos los headers de respuesta de Google hacia tu navegador
        res.set('Content-Range', driveResponse.headers['content-range']);
        res.set('Accept-Ranges', driveResponse.headers['accept-ranges']);
        if (driveResponse.headers['content-length']){
            res.set('Content-Length', driveResponse.headers['content-length']);
        }
        res.set('Content-Type', driveResponse.headers['content-type']);
        
        // Replicamos el status code (200 o 206)
        res.status(driveResponse.status);

        // Pipe: Enviar el stream de Google directamente al cliente
        driveResponse.data.pipe(res);

        // Manejo de cierre de conexión
        res.on('close', () => {
            driveResponse.data.destroy();
        });

    } catch (error) {
        console.error('Error en el stream:', error.message);
        if (error.response) {
            console.error('Detalle error Google:', error.response.status);
            console.error('Headers:', error.response.headers);
        }
        if (!res.headersSent) {
            res.sendStatus(500);
        }
    }
});

// --- RUTAS DE AUTENTICACIÓN ---

// 1. Ruta para canjear el código por tokens (Login inicial)
app.post('/auth/google', async (req, res) => {
    const { code } = req.body;
    try {
        // Canjeamos el código por tokens (access_token y refresh_token)
        const { tokens } = await oauth2Client.getToken(code);
        res.json(tokens);
    } catch (error) {
        console.error('Error al canjear token:', error);
        res.status(500).send('Error de autenticación');
    }
});

// 2. Ruta para renovar el token cuando caduca
app.post('/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    try {
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2Client.refreshAccessToken();
        res.json(credentials);
    } catch (error) {
        console.error('Error al refrescar token:', error);
        res.status(401).send('No se pudo refrescar');
    }
});

// -- SOCKET.IO --
io.on('connection', (socket) => {

    //Unirse a una sala
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        
        // Emitir cantidad de usuarios en la sala
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('room_users_update', { count: roomSize });

        socket.to(roomId).emit('user_joined', { userId: socket.id});
    });

    // Salir de una sala
    socket.on('leave_room', (roomId) => {
        socket.leave(roomId);
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('room_users_update', { count: roomSize });
    });

    //Sincronizacion de reproducción
    socket.on('sync_action', (data) => {
        // data debe contener: { roomId, type, currentTime, videoUrl }
        const { roomId, type } = data;

        // Reenviar la acción a todos los demás en la sala
        socket.to(roomId).emit('sync_action', data);
    });

    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
                // Restamos 1 porque el usuario aún está en la sala durante 'disconnecting'
                io.to(room).emit('room_users_update', { count: Math.max(0, roomSize - 1) });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado: ' + socket.id);
    });
});

//Iniciar el servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
