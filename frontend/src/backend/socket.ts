import { getPageContext } from '../page-context';
import * as io from 'socket.io-client';

let socket: SocketIOClient.Socket;

function createSocket(): SocketIOClient.Socket {
   socket = io.connect('/');

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
