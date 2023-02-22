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
    message(pull) {
      const titles = pull.title;
      const text = `Pull ready for ${action}: ${titles}`;
      return {
        text,
        url: pull.getUrl(),
      };
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
