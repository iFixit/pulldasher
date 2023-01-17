import { useAllPulls } from '../pulldasher/pulls-context';
import { Pull } from '../pull';
import { Flex } from "@chakra-ui/react"
import { CommitStatus } from "../types"
import { useUrlState } from "../use-url-state"
import { CILane } from "./ci-lane";

export function CiDasher() {
   const [repo] = useUrlState('repo', '');
   const statusesByContext = useStatusesByContext(repo);
   return (<>
      <Flex
         direction="row"
         gap={[2,3,4,5]}
         m="auto"
         px="var(--body-gutter)">
         {mapMap(statusesByContext, (statuses, context) => (
            <CILane key={context} context={context} statuses={statuses}/>
         ))}
      </Flex>
   </>);
}

type StatusesByContext = Map<string, CommitStatus[]>;

function useStatusesByContext(repo: string): StatusesByContext {
   const allPulls = useAllPulls();
   const pulls = repo ? allPulls.filter((pull) => pull.repo == repo) : allPulls;
   return pulls.reduce((byContext, pull: Pull) => {
      pull.buildStatuses().forEach((status) => {
         const {context} = status.data;
         const statuses = getOrInitMap(byContext, context, () => []);
         statuses.push(status);
      });
      return byContext;
   }, new Map());
}

function getOrInitMap<K, V>(map: Map<K, V>, key: K, init: () => V): V {
   const value = map.get(key);
   if (value) {
      return value;
   }
   const newValue = init();
   map.set(key, newValue);
   return newValue;
}

function mapMap<K, V, X>(map: Map<K, V>, closure: (value: V, key: K) => X): X[] {
   const result: X[] = [];
   map.forEach((v, k) => {
      result.push(closure(v, k));
   });
   return result;
}
