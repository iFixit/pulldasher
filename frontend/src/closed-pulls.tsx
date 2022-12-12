import { useFilteredPulls } from './pulldasher/pulls-context';
import { useStyleConfig, Flex, Spacer, Box } from "@chakra-ui/react"
import { ClosedPullCard } from "./pull-card";
import { closedAtCompare } from './pulldasher/sort';
import { useMemo } from "react";

export function ClosedPulls({onClickClose}: {onClickClose: () => void}) {
   const filteredPulls = useFilteredPulls();
   const closedPulls = useMemo(() => {
      return filteredPulls.filter(pull => pull.closed_at);
   }, [filteredPulls]);

   const styles = useStyleConfig('Column', {variant: "closed"});
   return (
      <Box __css={styles}
         position="absolute"
         right="0"
         top="70"
         bottom="0"
         width="300px"
         boxShadow="0px 0px 10px 0px #00000020">
         <Flex className="column_header" onClick={onClickClose}>
            <Box p={3} pl={4}>Recently Closed Pulls</Box>
            <Spacer/>
            <Box className="pull_count" p={3}>{closedPulls.length}</Box>
         </Flex>
         {closedPulls.map(pull =>
            <ClosedPullCard key={pull.getKey()} pull={pull} show={true}/>
         )}
      </Box>
   );
}

