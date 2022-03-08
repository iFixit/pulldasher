import { getPageContext } from '../page-context';
import * as io from 'socket.io-client';

type SocketPromise = Promise<SocketIOClient.Socket>;
let socket: SocketPromise;

function createSocket(): Promise<SocketIOClient.Socket> {
   return new Promise((resolve) => {
      const socket = io.connect('/');

      socket.on('connect', function() {
         getPageContext().then((details) => {
            socket.emit('authenticate', details.socketToken);
         });
      });
      resolve(socket);
   });
}

export function getSocket(): SocketPromise {
   return socket = socket || createSocket();
}
