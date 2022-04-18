import { getPageContext } from '../page-context';
import { io, Socket } from 'socket.io-client';

type SocketIO = Socket;

let socket: SocketIO;

function createSocket(): SocketIO {
   socket = io();

   socket.on('connect', function() {
      getPageContext().then((details) => {
         socket.emit('authenticate', details.socketToken);
      });
   });
   return socket;
}

export function getSocket() {
   return socket = socket || createSocket();
}
