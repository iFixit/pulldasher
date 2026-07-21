import { io, type Socket } from 'socket.io-client';
import type { InitializePayload, PullData, TokenResponse } from '../types';
import { isDummy, loadDummy, dummyUser } from './dummy';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** login → { login, at } for the pull that logged the claim; at is ms epoch. */
export type ReviewClaims = Record<string, { login: string; at: number }>;

export interface Backend {
   /** Resolves once we know who the viewer is (the /token user). */
   whoami: () => Promise<string>;
   /** Streams the initial snapshot, then one pull per change. */
   onPulls: (handler: (payload: InitializePayload | PullData) => void) => void;
   onConnection: (handler: (state: ConnectionState) => void) => () => void;
   refreshPull: (repo: string, number: number) => void;
   /** The whole claims map, resent on connect and on every change — the
    * server owns expiry (4h) and last-writer-wins, so the client never
    * reconciles a diff, just replaces its copy. */
   onReviewClaims: (handler: (claims: ReviewClaims) => void) => void;
   /** Ask to review a pull. The server derives the login from the socket's
    * own auth — no login argument here. ttlMs is how long the claim should
    * last before the server expires it; the server clamps it to [5min, 24h]
    * and defaults to 4h if omitted. */
   claimReview: (repo: string, number: number, ttlMs?: number) => void;
   releaseReview: (repo: string, number: number) => void;
}

function liveBackend(): Backend {
   let socket: Socket | null = null;
   let token: Promise<TokenResponse> | null = null;

   const getToken = () => {
      token =
         token ??
         fetch('/token').then(async r => {
            if (!r.ok) throw new Error(`token fetch failed: ${r.status}`);
            const t = (await r.json()) as TokenResponse;
            if (!t.socketToken) throw new Error('token response missing socketToken');
            return t;
         });
      return token;
   };

   let onState: ((state: ConnectionState) => void) | null = null;

   const getSocket = () => {
      if (socket) return socket;
      socket = io();
      socket.on('connect', () => {
         // Socket tokens are single-use and expire quickly: re-fetch on every
         // (re)connect rather than reusing the first one.
         token = null;
         getToken().then(
            t => socket!.emit('authenticate', t.socketToken),
            () => onState?.('error')
         );
      });
      socket.on('connect_error', () => onState?.('error'));
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
         onState = handler;
         const s = getSocket();
         const connected = () => handler('connected');
         const disconnected = () => handler('disconnected');
         const connecting = () => handler('connecting');
         s.on('connect', connected);
         s.on('disconnect', disconnected);
         s.io.on('reconnect_attempt', connecting);
         return () => {
            onState = null;
            s.off('connect', connected);
            s.off('disconnect', disconnected);
            s.io.off('reconnect_attempt', connecting);
         };
      },
      refreshPull(repo, number) {
         getSocket().emit('refresh', repo, number);
      },
      onReviewClaims(handler) {
         getSocket().on('reviewClaims', (claims: ReviewClaims) => handler(claims));
      },
      claimReview(repo, number, ttlMs) {
         getSocket().emit('claimReview', repo, number, ttlMs);
      },
      releaseReview(repo, number) {
         getSocket().emit('releaseReview', repo, number);
      },
   };
}

function dummyBackend(): Backend {
   let emit: ((payload: InitializePayload | PullData) => void) | null = null;
   let loaded: InitializePayload | null = null;
   let staggered = 0;
   // The dummy stand-in for the server's claims map: mutated locally by
   // claimReview/releaseReview and re-emitted, same shape a real socket
   // 'reviewClaims' broadcast would carry.
   const claims: ReviewClaims = {};
   let onClaims: ((claims: ReviewClaims) => void) | null = null;
   const publishClaims = () => onClaims?.({ ...claims });

   return {
      whoami: () => Promise.resolve(dummyUser()),
      onPulls(handler) {
         emit = handler;
         void loadDummy().then(payload => {
            loaded = payload;
            handler(payload);
            // Seed one pre-existing claim by a fixture teammate on a
            // deterministic reviewable pull, so "X is reading it" is
            // QA-able without a second client — a beat after load so it
            // reads as someone already at their desk, not a race with the
            // initial render.
            setTimeout(() => {
               const target = payload.pulls.find(
                  p =>
                     p.state === 'open' &&
                     !p.draft &&
                     p.user.login !== dummyUser() &&
                     p.status.allCR.filter(s => s.data.active).length < p.status.cr_req
               );
               if (!target) return;
               claims[`${target.repo}#${target.number}`] = {
                  login: 'dummy-teammate',
                  at: Date.now(),
               };
               publishClaims();
            }, 500);
         });
      },
      onConnection(handler) {
         handler('connected');
         return () => undefined;
      },
      refreshPull(repo, number) {
         // The dummy data is static, but the refresh-progress UI still needs
         // arrivals to count — re-emit the same pull on a stagger so the
         // "X of N" counter animates to completion like a real refresh would.
         const pull = loaded?.pulls.find(p => p.repo === repo && p.number === number);
         if (!pull || !emit) return;
         staggered += 1;
         setTimeout(
            () => {
               staggered -= 1;
               emit?.(pull);
            },
            300 + staggered * 15
         );
      },
      onReviewClaims(handler) {
         onClaims = handler;
         publishClaims();
      },
      claimReview(repo, number, _ttlMs) {
         claims[`${repo}#${number}`] = { login: dummyUser(), at: Date.now() };
         publishClaims();
      },
      releaseReview(repo, number) {
         delete claims[`${repo}#${number}`];
         publishClaims();
      },
   };
}

export const backend: Backend = isDummy() ? dummyBackend() : liveBackend();
