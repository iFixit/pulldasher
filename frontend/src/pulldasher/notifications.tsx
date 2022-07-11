import { useNotification } from "../notifications";
import { getUser } from "../page-context";
import { Pull } from "../pull";

export function usePullNotification(pulls: Pull[], action: string) {
  useNotification<Pull>(pulls, {
    key: (pull: Pull) => pull.number,
    filter: (pull: Pull) => pull.isMine() || pull.hasOutdatedSig(getUser()),
    message(pulls) {
      const titles = pulls.map((p) => p.title).join(", ");
      console.log(action, titles);
      if (pulls.length === 1) {
        return `Pull ready for ${action}: ` + titles;
      }
      return `Pulls ready for ${action}: ${titles}`;
    },
  });
}
