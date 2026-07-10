// Thin indirection so any service can emit socket events without importing the
// Socket.IO server (avoids circular deps). `bindIo` is called once at startup.
let io = null;

export function bindIo(instance) {
  io = instance;
}

export function emitAll(event, payload) {
  if (io) io.emit(event, payload);
}

export function emitToRoom(room, event, payload) {
  if (io) io.to(room).emit(event, payload);
}

export function hasIo() {
  return !!io;
}
