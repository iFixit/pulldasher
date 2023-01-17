import { LinkBox, LinkOverlay, Box, VStack, useStyleConfig } from "@chakra-ui/react"
import { CommitStatus } from "../types"
import { useDurationMinutes } from "../utils";
import { sortBy } from 'lodash-es'

type CILaneProps = {
   context: string;
   statuses: CommitStatus[];
};

export function CILane({context, statuses}: CILaneProps) {
   const styles = useStyleConfig('CILane');
   const statusesWithTime = statuses.filter(status => status.data.started_at);
   const sorted = sortBy(statusesWithTime, (status) => (-(status.data.started_at || 0)));
   return (
      <Box __css={styles}>
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
      >
         {status.data.target_url && <LinkOverlay href={status.data.target_url}/>}
         {duration &&
         <Box className="ci-duration">{Math.ceil(duration)}m</Box>}
      </Box>
   </LinkBox>;
}
