import { useAllPulls } from '../pulldasher/pulls-context';
import { Pull } from '../pull';
import { Fragment } from 'react';
import { LinkBox, LinkOverlay, Box, Flex, VStack, useStyleConfig } from "@chakra-ui/react"
import { CommitStatus } from "../types"
import { useUrlState } from "../use-url-state"
import { useDurationMinutes } from "../utils";
import { sortBy } from 'lodash-es'

export function CiDasher() {
   const [repo] = useUrlState('ci-repo', "iFixit/ifixit");
   const statusesByContext = useStatusesByContext(repo);
   return (<>
      <Flex
         direction="row"
         gap={[2,3,4,5]}
         m="auto"
         px="var(--body-gutter)">
         {mapMap(statusesByContext, (statuses, context) => (
            <Fragment key={context}>
               <CILane context={context} statuses={statuses}/>
            </Fragment>
         ))}
      </Flex>
   </>);
}

type CILaneProps = {
   context: string;
   statuses: CommitStatus[];
};

function CILane({context, statuses}: CILaneProps) {
   const styles = useStyleConfig('CILane');
   const sorted = sortBy(statuses, (status) => (-(status.data.started_at || Date.now()/1000)));
   return (
      <Box __css={styles} flex={100}>
         <Box className="lane-header">{context}</Box>
         <VStack align="stretch">
            {sorted.map((status, index) => (
               <CICard key={index} status={status}/>
            ))}
         </VStack>
      </Box>
   );
}

function CICard({status}: {status: CommitStatus}) {
   const styles = useStyleConfig('CICard', {variant: status.data.state});
   const duration = useDurationMinutes(status);
   return <LinkBox>
   <Box
      __css={styles}
      h={((duration||0) + 5) * 10 + "px"}
      p={2}
   >
      {status.data.target_url && <LinkOverlay href={status.data.target_url}/>}
      {duration &&
      <Box className="ci-duration">{Math.ceil(duration)}m</Box>}
   </Box>
   </LinkBox>;
}

type StatusesByContext = Map<string, CommitStatus[]>;

function useStatusesByContext(repo: string): StatusesByContext {
   const allPulls = useAllPulls();
   const pulls = allPulls.filter((pull) => pull.repo == repo);
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
