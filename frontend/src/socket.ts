import getPageContext from './page-context';
import * as io from 'socket.io-client';

/**
 * Giving socket.io some types
 */
export interface Socket {
   on: (event: string, callback: (data: any) => void) => void;
   emit: (event: string, data: any) => void;
}

type InitFunc = (socket: Socket) => void;

let socket: Socket;

export function createSocket(onInit: InitFunc): Socket {
   socket = io.connect('/');

   socket.on('connect', function() {
      getPageContext().then((details) => {
         socket.emit('authenticate', details.socketToken);
      });
   });

   onInit(socket);
   return socket;
}

export default function(onInit: InitFunc): Socket {
   return socket = socket || createSocket(onInit);
}
