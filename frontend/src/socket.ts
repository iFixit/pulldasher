import { getPageContext } from './page-context';
import * as io from 'socket.io-client';

type InitFunc = (socket: SocketIOClient.Socket) => void;

let socket: SocketIOClient.Socket;

export function createSocket(onInit: InitFunc): SocketIOClient.Socket {
   socket = io.connect('/');

   socket.on('connect', function() {
      getPageContext().then((details) => {
         socket.emit('authenticate', details.socketToken);
      });
   });

   onInit(socket);
   return socket;
}

export function Socket(onInit: InitFunc): SocketIOClient.Socket {
   return socket = socket || createSocket(onInit);
}
