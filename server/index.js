require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();

const CLIENT_URL = process.env.CLIENT_URL;

//Configuracion de CORS para permitir solicitudes desde el frontend
app.use(cors({
    origin: CLIENT_URL, // direccion de frontend
    methods: ['GET', 'POST']
}));

const server = http.createServer(app);

//Configuracion de Socket.io (Sincronizacion)
const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        methods: ['GET', 'POST']
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
            console.log('Conexión cerrada por el cliente');
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

// -- SOCKET.IO --
io.on('connection', (socket) => {
    console.log('Usuario conectado: ' + socket.id);

    //Unirse a una sala
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Usuario ${socket.id} se unió a la sala: ${roomId}`);
        socket.to(roomId).emit('user_joined', { userId: socket.id});
    });

    //Sincronizacion de reproducción
    socket.on('sync_action', (data) => {
        // data debe contener: { roomId, type, currentTime, videoUrl }
        const { roomId, type } = data;
        console.log(`Acción de sincronización en sala ${roomId}: ${type}`);

        // Reenviar la acción a todos los demás en la sala
        socket.to(roomId).emit('sync_action', data);
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
