import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowUpgrades: true
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, '../dist')));

// Handle all routes by serving the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// Store room information
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('=== NEW CONNECTION ===');
  console.log('User connected with socket ID:', socket.id);

  // ハートビート機能
  socket.on('ping', () => {
    socket.emit('pong');
  });

  socket.on('join-room', ({ roomId, userId, userName }) => {
    console.log('=== JOIN ROOM REQUEST ===');
    console.log(`User ${userName} (${userId}) attempting to join room ${roomId}`);
    console.log('Socket ID:', socket.id);
    
    // Leave any existing rooms first
    const currentRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    currentRooms.forEach(room => {
      socket.leave(room);
      console.log(`Left previous room: ${room}`);
    });
    
    // Join the new room
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
      console.log(`Created new room: ${roomId}`);
    }
    
    const room = rooms.get(roomId);
    
    // Get existing participants before adding new user
    const existingParticipants = Array.from(room.values()).filter(p => p.userId !== userId);
    console.log(`Existing participants in room ${roomId}:`, existingParticipants.map(p => p.userName));
    
    // Add new user to room
    room.set(userId, {
      socketId: socket.id,
      userName,
      userId
    });
    
    console.log(`Room ${roomId} now has ${room.size} participants:`, Array.from(room.keys()));
    
    // Send existing participants to the new user
    if (existingParticipants.length > 0) {
      console.log(`Sending ${existingParticipants.length} existing participants to new user`);
      socket.emit('room-participants', existingParticipants);
    }
    
    // Notify existing participants about the new user
    console.log(`Notifying existing participants about new user: ${userName}`);
    socket.to(roomId).emit('user-joined', { userId, userName });
    
    console.log(`=== JOIN COMPLETE ===`);
    console.log(`User ${userName} successfully joined room ${roomId}`);
  });

  socket.on('offer', ({ targetUserId, offer, roomId }) => {
    console.log('=== OFFER RECEIVED ===');
    const callerUserId = getUserIdBySocket(socket.id, roomId);
    console.log(`Offer from ${callerUserId} to ${targetUserId} in room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room && room.has(targetUserId)) {
      const targetSocket = room.get(targetUserId).socketId;
      console.log(`Forwarding offer to socket: ${targetSocket}`);
      
      io.to(targetSocket).emit('offer', {
        offer,
        callerUserId
      });
      console.log(`Offer successfully forwarded to ${targetUserId}`);
    } else {
      console.error(`Target user ${targetUserId} not found in room ${roomId}`);
      console.error('Available users in room:', room ? Array.from(room.keys()) : 'Room not found');
    }
  });

  socket.on('answer', ({ targetUserId, answer, roomId }) => {
    console.log('=== ANSWER RECEIVED ===');
    const answererUserId = getUserIdBySocket(socket.id, roomId);
    console.log(`Answer from ${answererUserId} to ${targetUserId} in room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room && room.has(targetUserId)) {
      const targetSocket = room.get(targetUserId).socketId;
      console.log(`Forwarding answer to socket: ${targetSocket}`);
      
      io.to(targetSocket).emit('answer', {
        answer,
        answererUserId
      });
      console.log(`Answer successfully forwarded to ${targetUserId}`);
    } else {
      console.error(`Target user ${targetUserId} not found in room ${roomId}`);
      console.error('Available users in room:', room ? Array.from(room.keys()) : 'Room not found');
    }
  });

  socket.on('ice-candidate', ({ targetUserId, candidate, roomId }) => {
    console.log('=== ICE CANDIDATE RECEIVED ===');
    const senderUserId = getUserIdBySocket(socket.id, roomId);
    console.log(`ICE candidate from ${senderUserId} to ${targetUserId} in room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room && room.has(targetUserId)) {
      const targetSocket = room.get(targetUserId).socketId;
      
      io.to(targetSocket).emit('ice-candidate', {
        candidate,
        senderUserId
      });
      console.log(`ICE candidate forwarded to ${targetUserId}`);
    } else {
      console.error(`Target user ${targetUserId} not found for ICE candidate`);
    }
  });

  socket.on('toggle-video', ({ roomId, isVideoOn }) => {
    const userId = getUserIdBySocket(socket.id, roomId);
    if (userId) {
      console.log(`User ${userId} toggled video: ${isVideoOn}`);
      socket.to(roomId).emit('user-video-toggled', { userId, isVideoOn });
    }
  });

  socket.on('toggle-audio', ({ roomId, isAudioOn }) => {
    const userId = getUserIdBySocket(socket.id, roomId);
    if (userId) {
      console.log(`User ${userId} toggled audio: ${isAudioOn}`);
      socket.to(roomId).emit('user-audio-toggled', { userId, isAudioOn });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('=== USER DISCONNECTED ===');
    console.log('Socket disconnected:', socket.id, 'Reason:', reason);
    
    // Remove user from all rooms
    let userInfo = null;
    rooms.forEach((room, roomId) => {
      const userEntry = Array.from(room.entries()).find(([_, user]) => user.socketId === socket.id);
      if (userEntry) {
        const [userId, user] = userEntry;
        userInfo = { userId, userName: user.userName, roomId };
        
        // Remove user from room
        room.delete(userId);
        console.log(`Removed user ${user.userName} from room ${roomId}`);
        
        // Notify other users in the room
        socket.to(roomId).emit('user-left', { userId, userName: user.userName });
        console.log(`Notified room ${roomId} that user ${user.userName} left`);
        
        // Remove room if empty
        if (room.size === 0) {
          rooms.delete(roomId);
          console.log(`Deleted empty room: ${roomId}`);
        } else {
          console.log(`Room ${roomId} now has ${room.size} participants`);
        }
      }
    });
    
    if (userInfo) {
      console.log(`Cleanup complete for user: ${userInfo.userName}`);
    } else {
      console.log('No user info found for disconnected socket');
    }
  });

  function getUserIdBySocket(socketId, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      console.error(`Room ${roomId} not found when looking for socket ${socketId}`);
      return null;
    }
    
    const userEntry = Array.from(room.entries()).find(([_, user]) => user.socketId === socketId);
    if (!userEntry) {
      console.error(`User with socket ${socketId} not found in room ${roomId}`);
      console.error('Available users:', Array.from(room.entries()).map(([id, user]) => ({ id, socketId: user.socketId })));
      return null;
    }
    
    return userEntry[0];
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`=== SERVER STARTED ===`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});