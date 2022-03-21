import { useState, useCallback, useEffect } from 'react';

type state = string|null;
type stateSetter = (state: state) => void;
type stringSetter = (state: string) => void;

type useUrlStateReturn = [
   string,
   stateSetter,
];

type HistoryState = Record<string, string>;

/**
 * like useState(), but the state is stored in the url as a query param.
 * Loads it from a query param on page refresh and updates the url as the state
 * changes.
 * paramName is expected not to change over the life of the component.
 */
export function useUrlState(paramName: string, paramDefault: string): useUrlStateReturn  {
   const [state, setState] = useState(paramDefault);

   // Load state from url, only once per component
   useEffect(() => {
      const unsubscribe = watchForPopstate(paramName, setState, paramDefault);
      const url = new URL(window.location.href);
      const urlState = url.searchParams.get(paramName);
      if (urlState === null || urlState === state) {
         return;
      }
      setState(urlState);
      return unsubscribe;
   }, []);

   // Wrap setState so it pushes history and transforms the url
   const setUrlState = useCallback((newState: state) => {
      // Turn null into the default so state is never null
      setState(newState || paramDefault);
      // Turn default into null so that default values disappear from the url
      pushStateToUrl(paramName, newState === paramDefault ? null : newState);
   }, []);

   return [state, setUrlState];
}

function watchForPopstate(paramName: string, setState: stringSetter, paramDefault: string) {
   const handler = (event: PopStateEvent) => {
      const stateFromHistory = event.state ?  event.state[paramName] : undefined;
      setState(stateFromHistory || paramDefault);
   };
   window.addEventListener('popstate', handler);
   return () => window.removeEventListener('popstate', handler);
}

/**
 * Update the current url to match the new state and push the new historyState
 * on the stack
 */
function pushStateToUrl(paramName: string, newState: state): void {
   const url = new URL(window.location.href);
   if (newState) {
      url.searchParams.set(paramName, newState);
   } else {
      url.searchParams.delete(paramName);
   }
   history.pushState(urlToStateObject(url), '', url.toString());
}

function urlToStateObject(url: URL): HistoryState {
   const historyState: HistoryState = {};
   url.searchParams.forEach((value, key) => {
      historyState[key] = value;
   });
   return historyState;
}

/**
 * Just like useUrlState(), but typed for storing a boolean
 */
export function useBoolUrlState(paramName: string, paramDefault: boolean): [boolean, (state: boolean|null) => void] {
   const [state, setState] = useUrlState(paramName, paramDefault ? '1' : '0');

   const setBoolState = useCallback((newState: boolean) => {
      setState(newState ? '1' : '0');
   }, []);

   return [state === '1', setBoolState];
}
