require('dotenv').config();
const { google } = require('googleapis');
const express = require('express');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const cookieParser = require('cookie-parser');
const compression = require('compression');

const app = express();

const INITIAL_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB (Fast Start)
const REGULAR_CHUNK_SIZE = 3 * 1024 * 1024; // 3MB (Regular Stream)
const IS_PROD = process.env.NODE_ENV === 'production';
const videoSizeCache = new Map();

// Configuración de reintentos para Axios
axiosRetry(axios, { 
    retries: 3, 
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        if (error) console.warn(`[AXIOS RETRY] Reintentando: ${error.message}`);
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500;
    }
});

const httpsAgent = new https.Agent({
    keepAlive: true, 
    keepAliveMsecs: 10000, 
    maxSockets: 50 
});

const allowedOrigins = [
    'https://netflis123.web.app',      
    'https://netflis.practicas.me',    
    'http://localhost:5173',           
    'http://localhost:3001'            
];

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'postmessage'
);

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use(compression());

const server = http.createServer(app);

const io = new Server(server, {
    pingTimeout: 120000,
    pingInterval: 25000,
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// -- MIDDLEWARE DE LOGGING GENERAL --
app.use((req, res, next) => {
    next();
});

// -- RUTAS -- 

// Ruta de streaming de video desde Google Drive
app.get('/stream/:fileId', async (req, res) => {
    const startObj = Date.now();
    let { fileId } = req.params;
    const access_token = req.query.access_token || req.cookies?.access_token;

    console.log('[STREAM-INIT] Solicitando video a drive');

    if (req.cookies?.access_token) console.log("[STREAM-AUTH] Token detectado en Cookie");
    else if (req.query.access_token) console.log("[STREAM-AUTH] Token detectado en URL");
    else console.warn("[STREAM-AUTH] NO SE DETECTÓ NINGÚN TOKEN");

    if (!fileId) return res.status(400).send('Falta el fileId');
    
    if (!access_token) {
        console.error('[STREAM-ERROR] Falta Access Token.');
        return res.status(401).send('Falta el Access token (Cookie o Query)');
    }

    try {
        let totalSize;
        if (videoSizeCache.has(fileId)) {
            totalSize = videoSizeCache.get(fileId);
        } else {
            console.log(`[STREAM-META] Obteniendo metadatos de Google Drive`);
            const metadataResponse = await axios({
                method: 'get',
                url: `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size`,
                headers: { Authorization: `Bearer ${access_token}` },
                httpsAgent: httpsAgent,
                timeout: 5000
            });

            totalSize = parseInt(metadataResponse.data.size, 10);
            videoSizeCache.set(fileId, totalSize);
            console.log(`[STREAM-META] Tamaño del video: ${(totalSize/1024/1024).toFixed(2)} MB`);
        }

        const range = req.headers.range;
        let start = 0;
        let end = totalSize - 1;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            start = parseInt(parts[0], 10);
            if (parts[1]) {
                end = parseInt(parts[1], 10);
            }
            console.log(`[STREAM-RANGE] Chunk solicitado: ${(start/1024/1024).toFixed(2)}-${(end/1024/1024).toFixed(2)} MB`);
        } else {
            console.log(`[STREAM-RANGE] Cliente NO solicitó rango. Enviando desde 0.`);
        }

        // Ajuste dinámico de chunks
        const currentChunkSize = (start === 0) ? INITIAL_CHUNK_SIZE : REGULAR_CHUNK_SIZE;
        const chunkEnd = Math.min(end, start + currentChunkSize - 1);
        console.log(`[STREAM-CHUNK] Solicitando Bytes: ${(start/1024/1024).toFixed(2)}-${(chunkEnd/1024/1024).toFixed(2)} MB`);

        const headers = {
            Authorization: `Bearer ${access_token}`,
            Range: `bytes=${start}-${chunkEnd}`
        };

        const driveStartTime = Date.now();
        const driveResponse = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            headers: headers,
            responseType: 'stream',
            httpsAgent: httpsAgent,
            validateStatus: (status) => status < 500,
            timeout: 0
        });

        console.log(`[STREAM-DRIVE-RES] Respuesta de Google en ${Date.now() - driveStartTime}ms. Status: ${driveResponse.status}`);

        if (driveResponse.status >= 400) {
             console.error(`[STREAM-ERROR] Error desde Google Drive: ${driveResponse.status}`);
             return res.sendStatus(driveResponse.status);
        }

        const contentLength = chunkEnd - start + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${chunkEnd}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': driveResponse.headers['content-type'] || 'video/mp4',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Keep-Alive': 'timeout=15',
        });

        // LOGGING DE FLUJO DE DATOS
        let downloadedBytes = 0;
        driveResponse.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
        });

        driveResponse.data.on('end', () => {
            console.log(`[STREAM-END] Chunk obtenido de Google: ${(downloadedBytes/1024/1024).toFixed(2)} MB. Tiempo: ${Date.now() - startObj}ms`);
        });

        driveResponse.data.on('error', (err) => {
            console.error(`[STREAM-ERROR] Error descargando el chunk: ${err.message}`);
        });

        driveResponse.data.pipe(res);

        res.on('close', () => {
            console.log(`[STREAM-CLOSE] Chunk cerrado. Enviado: ${(downloadedBytes/1024/1024).toFixed(2)} MB`);
            driveResponse.data.destroy();
        });

    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message === 'aborted') {
            console.log('[STREAM-ABORT] Conexión abortada.');
            return;
        }
        
        if (error.response && error.response.status) {
            console.error(`[STREAM-ERROR-GOOGLE] Google devolvió: ${error.response.status}`);
            if (!res.headersSent) return res.sendStatus(error.response.status);
        }

        console.error('[STREAM-CRITICAL] Error Stream:', error.message);
        if (!res.headersSent) res.sendStatus(500);
    }
});

// --- RUTAS DE AUTENTICACIÓN ---
app.post('/auth/google', async (req, res) => {
    console.log('[AUTH] Petición de login recibida');
    const { code } = req.body;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        res.cookie('access_token', tokens.access_token, {
            httpOnly: true,
            secure: IS_PROD,
            sameSite: IS_PROD ? 'none' : 'lax',
            maxAge: 3500 * 1000 // 58 min aprox
        });

        console.log('[AUTH] Tokens obtenidos y Cookie establecida');
        res.json(tokens);
    } catch (error) {
        console.error('[AUTH-ERROR] Error al canjear token:', error.message);
        res.status(500).send('Error de autenticación');
    }
});

app.post('/auth/refresh', async (req, res) => {
    console.log('[AUTH] Petición de refresh token');
    const { refreshToken } = req.body;
    try {
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        res.cookie('access_token', credentials.access_token, {
            httpOnly: true,
            secure: IS_PROD,
            sameSite: IS_PROD ? 'none' : 'lax',
            maxAge: 3500 * 1000
        });

        console.log('[AUTH] Token refrescado y Cookie actualizada');
        res.json(credentials);
    } catch (error) {
        console.error('[AUTH-ERROR] Error al refrescar token:', error.message);
        res.status(401).send('No se pudo refrescar');
    }
});

// -- SOCKET.IO --
io.on('connection', (socket) => {
    console.log('[SOCKET] Nuevo cliente conectado');

    socket.on('join_room', (roomId) => {
        console.log('[SOCKET] Cliente se une a sala');
        socket.join(roomId);
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('room_users_update', { count: roomSize });
        socket.to(roomId).emit('user_joined', { userId: socket.id});
    });

    socket.on('leave_room', (roomId) => {
        console.log('[SOCKET] Cliente deja sala');
        socket.leave(roomId);
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('room_users_update', { count: roomSize });
    });

    socket.on('sync_action', (data) => {
        const logData = { ...data };
        if (logData.videoData && logData.videoData.url) {
             logData.videoData = { 
                 ...logData.videoData, 
                 url: logData.videoData.url.replace(/access_token=[^&]+/, 'access_token=REDACTED') 
             };
        }
        console.log(`[SOCKET-SYNC] Acción recibida:`, logData.type);
        const { roomId } = data;
        socket.to(roomId).emit('sync_action', data);
    });

    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
                io.to(room).emit('room_users_update', { count: Math.max(0, roomSize - 1) });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Servidor corriendo: ${PORT}`);
});