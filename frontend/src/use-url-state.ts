import { useState, useCallback, useEffect, useMemo } from "react";

type state = string | null;
type stateSetter = (state: state) => void;
type stringSetter = (state: string) => void;

type useUrlStateReturn = [string, stateSetter];

type HistoryState = Record<string, string>;

/**
 * like useState(), but the state is stored in the url as a query param.
 * Loads it from a query param on page refresh and updates the url as the state
 * changes.
 * paramName is expected not to change over the life of the component.
 */
export function useUrlState(
  paramName: string,
  paramDefault: string
): useUrlStateReturn {
  const [state, setState] = useState(() =>
    parseStateFromUrl(paramName, paramDefault)
  );

  // Watch for url state changes (back button) only once per component.
  useEffect(() => watchForPopstate(paramName, setState, paramDefault), []);

  // Wrap setState so it pushes history and transforms the url
  const setUrlState = useCallback((newState: state) => {
    // Turn null into the default so state is never null
    setState(newState || paramDefault);
    // Turn default into null so that default values disappear from the url
    pushStateToUrl(paramName, newState === paramDefault ? null : newState);
  }, []);

  return [state, setUrlState];
}

function parseStateFromUrl(paramName: string, paramDefault: string): string {
  const url = new URL(window.location.href);
  return url.searchParams.get(paramName) ?? paramDefault;
}

function watchForPopstate(
  paramName: string,
  setState: stringSetter,
  paramDefault: string
) {
  const handler = (event: PopStateEvent) => {
    const stateFromHistory = event.state ? event.state[paramName] : undefined;
    setState(stateFromHistory || parseStateFromUrl(paramName, paramDefault));
  };
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
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
  history.pushState(urlToStateObject(url), "", url.toString());
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
export function useBoolUrlState(
  paramName: string,
  paramDefault: boolean
): [boolean, () => void] {
  const [state, setState] = useUrlState(paramName, paramDefault ? "1" : "0");

  const toggleBoolState = useCallback(() => {
    const newState = state == "0" ? "1" : "0";
    console.log(`Toggling ${paramName} from ${state} to ${newState}`);
    setState(newState);
  }, [state]);

  return [state === "1", toggleBoolState];
}

/**
 * Just like useUrlState(), but typed for storing an array of strings
 */
export function useArrayUrlState(
  paramName: string,
  paramDefault: string[]
): [string[], (state: string[]) => void] {
  const [state, setState] = useUrlState(paramName, paramDefault.join(","));

  const setArrayState = useCallback(
    (newState: string[]) => {
      setState(newState.join(","));
    },
    [setState]
  );

  // useMemo() is here so that downstream callers can depend on the array
  // staying the same referentially if the state hasn't changed.
  const valueArray = useMemo(() => (state ? state.split(",") : []), [state]);

  return [valueArray, setArrayState];
}
