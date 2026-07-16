import { io, type Socket } from 'socket.io-client';
import type { InitializePayload, PullData, TokenResponse } from '../types';
import { isDummy, loadDummy, dummyUser } from './dummy';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Backend {
   /** Resolves once we know who the viewer is (the /token user). */
   whoami: () => Promise<string>;
   /** Streams the initial snapshot, then one pull per change. */
   onPulls: (handler: (payload: InitializePayload | PullData) => void) => void;
   onConnection: (handler: (state: ConnectionState) => void) => () => void;
   refreshPull: (repo: string, number: number) => void;
}

function liveBackend(): Backend {
   let socket: Socket | null = null;
   let token: Promise<TokenResponse> | null = null;

   const getToken = () => {
      token = token ?? fetch('/token').then(r => r.json());
      return token;
   };

   const getSocket = () => {
      if (socket) return socket;
      socket = io();
      socket.on('connect', () => {
         // Socket tokens are single-use and expire quickly: re-fetch on every
         // (re)connect rather than reusing the first one.
         token = null;
         void getToken().then(t => socket!.emit('authenticate', t.socketToken));
      });
      return socket;
   };

   return {
      whoami: () => getToken().then(t => t.user),
      onPulls(handler) {
         const s = getSocket();
         s.on('initialize', (data: InitializePayload) => handler(data));
         s.on('pullChange', (pull: PullData) => handler(pull));
      },
      onConnection(handler) {
         const s = getSocket();
         const connected = () => handler('connected');
         const disconnected = () => handler('disconnected');
         const connecting = () => handler('connecting');
         s.on('connect', connected);
         s.on('disconnect', disconnected);
         s.io.on('reconnect_attempt', connecting);
         return () => {
            s.off('connect', connected);
            s.off('disconnect', disconnected);
            s.io.off('reconnect_attempt', connecting);
         };
      },
      refreshPull(repo, number) {
         getSocket().emit('refresh', repo, number);
      },
   };
}

function dummyBackend(): Backend {
   return {
      whoami: () => Promise.resolve(dummyUser()),
      onPulls(handler) {
         void loadDummy().then(payload => handler(payload));
      },
      onConnection(handler) {
         handler('connected');
         return () => {};
      },
      refreshPull() {
         // Nothing to refresh against; the dummy data is static.
      },
   };
}

export const backend: Backend = isDummy() ? dummyBackend() : liveBackend();
