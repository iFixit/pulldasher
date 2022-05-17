import { getPageContext } from '../page-context';
import { io, Socket } from 'socket.io-client';
import { useState, useEffect } from 'react';
import { hasDummyPulls } from  '../utils';

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

export enum ConnectionState {
   disconnected = "disconnected",
   connected = "connected",
   connecting = "connecting",
   error = "error",
}

export function useConnectionState(): ConnectionState {
   const [state, setState] = useState<ConnectionState>(ConnectionState.connecting);
   if (hasDummyPulls()) {
      return ConnectionState.connected;
   }
   useEffect(() => listenForConnectionEvents(setState), [getSocket()]);
   return state;
}

function listenForConnectionEvents(setState: (state: ConnectionState) => void) {
   const onConnect = () => setState(ConnectionState.connected);
   const onDisconnect = () => setState(ConnectionState.disconnected);
   const onReconnectAttempt = () => setState(ConnectionState.connecting);
   const socket = getSocket();
   socket.on('connect', onConnect);
   socket.on('disconnect', onDisconnect);
   socket.io.on('reconnect_attempt', onReconnectAttempt);
   socket.io.engine.on('close', onDisconnect);
   return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.engine.off('close', onDisconnect);
   };
}
