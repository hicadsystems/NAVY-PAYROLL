let socket = null;

function initSocket() {

    if (socket?.connected) return socket;

    socket = io({

        auth: {
            token: localStorage.getItem("token")
        }

    });

    socket.on("connect", () => {
        console.log("Socket Connected");
    });

    socket.on("disconnect", () => {
        console.log("Socket Disconnected");
    });

    return socket;
}

window.initSocket = initSocket;
window.getSocket = () => socket;