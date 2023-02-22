import { useNotification } from "../notifications";
import { getUser } from "../page-context";
import { Pull } from "../pull";

export function usePullNotification(
  pulls: Pull[],
  action: string,
  filter: (pull: Pull) => boolean
) {
  useNotification<Pull>(pulls, {
    key: (pull: Pull) => pull.number,
    filter,
    message(pulls) {
      const titles = pulls.map((p) => p.title).join(", ");
      const pull = pulls.length === 1 ? "Pull" : "Pulls";
      return `${pull} ready for ${action}: ${titles}`;
    },
  });
}

export function useMyPullNotification(pulls: Pull[], action: string) {
  usePullNotification(pulls, action, (pull: Pull) => pull.isMine());
}
export function useMyReviewNotification(pulls: Pull[], action: string) {
  usePullNotification(pulls, action, (pull: Pull) =>
    pull.hasOutdatedSig(getUser())
  );
}
