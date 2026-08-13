// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// In-memory store of clients per room
// rooms: { roomId: { socketId: clientData } }
const rooms = {};

io.on('connection', (socket) => {
  let myRoom = null;

  socket.on('join-room', (room) => {
    myRoom = room || 'default';
    socket.join(myRoom);
    if (!rooms[myRoom]) rooms[myRoom] = {};
    rooms[myRoom][socket.id] = { id: socket.id };
    // Broadcast current peers to new client
    const peers = Object.values(rooms[myRoom]).filter(c => c.id !== socket.id);
    socket.emit('peers', peers);
  });

  socket.on('update', (data) => {
    if (!myRoom) return;
    // store latest data for this socket in the room
    rooms[myRoom][socket.id] = Object.assign({}, rooms[myRoom][socket.id] || {}, {
      id: socket.id,
      name: data.name || socket.id,
      lat: data.lat,
      lon: data.lon,
      heading: (typeof data.heading === 'number') ? data.heading : null,
      updatedAt: Date.now()
    });
    // Broadcast update to other clients in the same room
    socket.to(myRoom).emit('peer-update', rooms[myRoom][socket.id]);
  });

  socket.on('disconnect', () => {
    if (!myRoom) return;
    delete rooms[myRoom][socket.id];
    socket.to(myRoom).emit('peer-left', { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
