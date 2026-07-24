import { io, type Socket } from 'socket.io-client';
import type { InitializePayload, PullData, TokenResponse } from '../../../shared/types';
import { isDummy, loadDummy, dummyUser } from './dummy';
import { readSessionStorage, writeSessionStorage } from '../storage';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Backend {
   /** Resolves once we know who the viewer is (the /token user). */
   whoami: () => Promise<string>;
   /** Streams the initial snapshot, then one pull per change. */
   onPulls: (handler: (payload: InitializePayload | PullData) => void) => void;
   onConnection: (handler: (state: ConnectionState) => void) => () => void;
   refreshPull: (repo: string, number: number) => void;
   /** Ask to review a pull. The server derives the login from the socket's
    * own auth — no login argument here. A claim is a GitHub review request
    * the reviewer made on themselves (see types.ts's review_requests), so it
    * has no client-side TTL: it clears when the review is submitted,
    * released, or removed on GitHub, same as any other review request. */
   claimReview: (repo: string, number: number) => void;
   releaseReview: (repo: string, number: number) => void;
}

function liveBackend(): Backend {
   let socket: Socket | null = null;
   let token: Promise<TokenResponse> | null = null;

   const getToken = () => {
      token =
         token ??
         fetch('/token').then(async r => {
            // an expired session redirects toward the OAuth flow instead of
            // returning JSON — surface that as a failure, not a parse error
            if (!r.ok || r.redirected) throw new Error(`token fetch failed: ${r.status}`);
            const t = (await r.json()) as TokenResponse;
            if (!t.socketToken) throw new Error('token response missing socketToken');
            return t;
         });
      // a failed fetch must not poison the cache: the next caller retries
      // instead of replaying tonight's rejection forever
      token.catch(() => {
         token = null;
      });
      return token;
   };

   let onState: ((state: ConnectionState) => void) | null = null;

   // Overnight, the app session cookie can expire while the tab sleeps; the
   // socket then reconnects fine but /token fails and the board would sit on
   // "retrying" forever. A visible, online tab whose token keeps failing gets
   // ONE reload per 5 minutes: the page-level auth gate re-runs the OAuth
   // handshake (silent with a live GitHub session) and comes back signed in.
   const RELOAD_AT_KEY = 'pd2.authReloadAt';
   const maybeReloadForAuth = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const last = Number(readSessionStorage(RELOAD_AT_KEY) || 0);
      if (Date.now() - last < 5 * 60_000) return;
      writeSessionStorage(RELOAD_AT_KEY, String(Date.now()));
      location.reload();
   };

   // The auth handshake retries on its own: a socket that reconnected after a
   // sleep is useless until 'authenticate' lands, so a token failure backs
   // off (2s → 30s cap) instead of giving up after one shot. A new connect or
   // a disconnect always resets the loop.
   let authRetry: ReturnType<typeof setTimeout> | null = null;
   const clearAuthRetry = () => {
      if (authRetry != null) clearTimeout(authRetry);
      authRetry = null;
   };
   const authenticate = (attempt = 0) => {
      // Socket tokens are single-use and expire quickly: re-fetch on every
      // (re)connect rather than reusing the first one.
      token = null;
      getToken().then(
         t => socket!.emit('authenticate', t.socketToken),
         () => {
            onState?.('error');
            if (attempt >= 1) maybeReloadForAuth();
            clearAuthRetry();
            authRetry = setTimeout(
               () => authenticate(attempt + 1),
               Math.min(30_000, 2_000 * 2 ** attempt)
            );
         }
      );
   };

   const getSocket = () => {
      if (socket) return socket;
      socket = io();
      socket.on('connect', () => {
         clearAuthRetry();
         authenticate();
      });
      socket.on('disconnect', () => clearAuthRetry());
      socket.on('connect_error', () => onState?.('error'));
      // Chrome freezes background tabs and laptops sleep; on wake, socket.io
      // would sit out the rest of its backoff before trying again. Any wake
      // signal — the tab becoming visible, the window refocusing, the network
      // returning — skips the wait and reconnects now.
      const wake = () => {
         if (socket && !socket.connected) socket.connect();
      };
      document.addEventListener('visibilitychange', () => {
         if (document.visibilityState === 'visible') wake();
      });
      window.addEventListener('focus', wake);
      window.addEventListener('online', wake);
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
      claimReview(repo, number) {
         getSocket().emit('claimReview', repo, number);
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

   /** Mutate one dummy pull in place and re-emit it through the normal
    * pullChange path — the dummy board's stand-in for a server round trip
    * (a claim/release now travels as a pull update, not a separate map). */
   function updatePull(repo: string, number: number, fn: (pull: PullData) => PullData) {
      if (!loaded) return;
      const idx = loaded.pulls.findIndex(p => p.repo === repo && p.number === number);
      if (idx === -1) return;
      const next = fn(loaded.pulls[idx]);
      loaded.pulls[idx] = next;
      emit?.(next);
   }

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
               updatePull(target.repo, target.number, pull => ({
                  ...pull,
                  review_requests: [
                     ...(pull.review_requests ?? []),
                     { login: 'dummy-teammate', at: Math.floor(Date.now() / 1000), self: true },
                  ],
               }));
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
      claimReview(repo, number) {
         updatePull(repo, number, pull => ({
            ...pull,
            requested_reviewers: [...new Set([...(pull.requested_reviewers ?? []), dummyUser()])],
            review_requests: [
               ...(pull.review_requests ?? []).filter(r => r.login !== dummyUser()),
               { login: dummyUser(), at: Math.floor(Date.now() / 1000), self: true },
            ],
         }));
      },
      releaseReview(repo, number) {
         updatePull(repo, number, pull => ({
            ...pull,
            requested_reviewers: (pull.requested_reviewers ?? []).filter(l => l !== dummyUser()),
            review_requests: (pull.review_requests ?? []).filter(r => r.login !== dummyUser()),
         }));
      },
   };
}

export const backend: Backend = isDummy() ? dummyBackend() : liveBackend();
