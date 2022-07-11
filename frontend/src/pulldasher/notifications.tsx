import { useNotification } from "../notifications";

type Pulls = Parameters<typeof useNotification>[0];

export function useNotifyReadyPull(pulls: Pulls) {
  useNotification(pulls, {
    message: (titles, pulls) => {
      if (pulls.length === 1) {
        return "Pull ready: " + titles;
      }
      return `Pulls ready: ${titles}`;
    },
  });
}
