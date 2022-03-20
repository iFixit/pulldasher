import { useState, useCallback, useEffect } from 'react';

type state = string|null;
type stateSetter = (state: state) => void;

type useUrlStateReturn = [
   string,
   stateSetter,
];

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
      const url = new URL(window.location.href);
      const urlState = url.searchParams.get(paramName);
      if (urlState === null || urlState === state) {
         return;
      }
      setState(urlState);
   }, []);

   // Wrap setState so it pushes history and transforms the url
   const setUrlState = useCallback((newState: state) => {
      const isDefault = newState === paramDefault;
      // Turn null into the default so state is never null
      setState(newState === null ? paramDefault : newState);
      // Turn default into null so that default values disappear from the url
      pushStateToUrl(paramName, isDefault ? null : newState);
   }, []);

   return [state, setUrlState];
}

/**
 * Update the current url to match the new state
 */
function pushStateToUrl(paramName: string, newState: state): void {
   const url = new URL(window.location.href);
   if (newState === null) {
      url.searchParams.delete(paramName);
   } else {
      url.searchParams.set(paramName, newState);
   }
   history.replaceState({}, '', url.toString());
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
