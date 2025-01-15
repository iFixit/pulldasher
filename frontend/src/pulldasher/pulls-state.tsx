import { useState, useEffect } from "react";
import { throttle } from "lodash-es";
import { createPullSocket } from "../backend/pull-socket";
import { PullData, RepoSpec } from "../types";
import { Pull } from "../pull";

function onPullsChanged(pullsChanged: (pulls: Pull[], repoSpecs: RepoSpec[]) => void) {
  const pulls: Record<string, Pull> = {};
  const pullRefresh = () => pullsChanged(Object.values(pulls), repoSpecs);
  const throttledPullRefresh: () => void = throttle(pullRefresh, 500);
  let repoSpecs: RepoSpec[] = [];

  createPullSocket((pullDatas: PullData[], newRepoSpecs: RepoSpec[]) => {
    pullDatas.forEach((pullData: PullData) => {
      pullData.repoSpec =
        newRepoSpecs.find((repo) => repo.name == pullData.repo) || null;
      pullData.received_at = new Date();
      const pull: Pull = new Pull(pullData);
      pulls[pull.getKey()] = pull;
    });

    repoSpecs = newRepoSpecs || [];
    throttledPullRefresh();
  });
}

/**
 * Note: This is only meant to be used in one component
 */
let socketInitialized = false;
export function usePullsState() {
  const [pullState, setPullsState] = useState<Pull[]>([]);
  const [repoSpecs, setRepoSpecs] = useState<RepoSpec[]>([]);
  useEffect(() => {
    if (socketInitialized) {
      throw new Error(
        "usePullsState() connects to socket-io and is only meant to be used in the PullsProvider component, see useFilteredOpenPulls() instead."
      );
    }
    socketInitialized = true;
    onPullsChanged((pulls, repoSpecs) => {
      setPullsState(pulls);
      setRepoSpecs(repoSpecs);
    });
  }, []);
  return {pullState, repoSpecs};
}
