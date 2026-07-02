const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cfg = require("../config");

class SocketService {
  // =========================
  // STATIC SHARED STATE
  // =========================
  static io = null;

  static activeRooms = new Map(); // room -> { users, contact, messages }
  static userSockets = new Map(); // userId -> socketId

  // =========================
  // INIT (called once)
  // =========================
  static init(server) {
    if (this.io) return this.io; // prevent double init

    console.log("Sockets Initializing");

    this.io = new Server(server, {
      cors: {
        origin: [
          "http://localhost:5500",
          "http://127.0.0.1:5500",
          "https://hicad.ng", // production
        ].filter(Boolean),
        credentials: true,
      },
    });

    this.setupAuth();
    this.handleConnections();

    console.log("Sockets Initialized");

    return this.io;
  }

  // =========================
  // JWT AUTH
  // =========================
  static setupAuth() {
    console.log("setting up auth");
    this.io.use((socket, next) => {
      console.log("set up");
      const token = socket.handshake.auth?.token;

      if (!token) {
        console.log("no token");
        socket.authError = "NO_TOKEN";
        return next(); // do NOT throw
      }

      try {
        const decoded = jwt.verify(token, cfg.jwt.secret);

        socket.user = decoded;
        socket.userId = decoded.user_id || decoded.userId || decoded.id;

        next();
      } catch (err) {
        next(new Error("Authentication error: Invalid token"));
      }
    });
    console.log("autj setup");
  }

  // =========================
  // CONNECTION HANDLER
  // =========================
  static handleConnections() {
    this.io.on("connection", (socket) => {
      this.userSockets.set(socket.userId, socket.id);

      socket.emit("connected", {
        message: "Connected to support chat",
        userId: socket.userId,
      });

      this.registerEvents(socket);
    });
  }

  // =========================
  // EVENTS
  // =========================
  static registerEvents(socket) {
    socket.on("mail:read", (data) => this.markMailRead(socket, data));

    socket.on("disconnect", (reason) => this.onDisconnect(socket, reason));

    socket.on("error", (error) => this.onError(socket, error));

    
  }

  // =========================
  // DISCONNECT
  // =========================
  static onDisconnect(socket, reason) {
    this.userSockets.delete(socket.userId);

    for (const [room, data] of this.activeRooms.entries()) {
      data.users.delete(socket.userId);
      if (data.users.size === 0) {
        this.activeRooms.delete(room);
      }
    }
  }

  static onError(socket, error) {
    socket.emit("error", { message: error.message });
  }

  // =========================
  // EMIT TO A SPECIFIC USER
  // =========================
  static emitToUser(userId, event, payload) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, payload);
    }
  }


  static newMail(userId, message) {
    this.emitToUser(userId, "mail:new", message);
}

static updateBadge(userId, unread) {
    this.emitToUser(userId, "mail:badge", {
        unread
    });
}

static approvalUpdated(userId, approval) {
    this.emitToUser(userId, "approval:update", approval);
}
}

module.exports = SocketService;
