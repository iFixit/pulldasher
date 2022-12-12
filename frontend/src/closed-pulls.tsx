import { useFilteredPulls, useAllPulls } from './pulldasher/pulls-context';
import { useStyleConfig, Flex, Spacer, Box, Button } from "@chakra-ui/react"
import { ClosedPullCard } from "./pull-card";
import { useBoolUrlState } from "./use-url-state";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilter } from '@fortawesome/free-solid-svg-icons'

export function ClosedPulls({onClickClose}: {onClickClose: () => void}) {
   const [showUnfilteredPulls, toggleShowUnfilteredPulls] = useBoolUrlState("uncl", false);
   const allPulls = useAllPulls();
   const filteredPulls = useFilteredPulls();
   const pullsToCareAbout = showUnfilteredPulls ? allPulls : filteredPulls;
   const closedPulls = pullsToCareAbout.filter(pull => pull.closed_at);

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
            <Box p={3} pl={4}>Recently Closed Pulls
               <Button
                  ml={2}
                  my={-4}
                  p={1}
                  size="sm"
                  title="Filter Pulls"
                  colorScheme="blue"
                  variant={showUnfilteredPulls ? 'ghost' : 'solid'}
                  onClick={(e) => {e.stopPropagation(); toggleShowUnfilteredPulls()}}>
                  <FontAwesomeIcon icon={faFilter}/>
               </Button>
            </Box>
            <Spacer/>
            <Box className="pull_count" p={3}>{closedPulls.length}</Box>
         </Flex>
         {closedPulls.map(pull =>
            <ClosedPullCard key={pull.getKey()} pull={pull} show={true}/>
         )}
      </Box>
   );
}

