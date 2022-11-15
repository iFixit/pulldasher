import { useAllPulls, useAllOpenPulls } from './pulls-context';
import { Pull } from '../pull';
import { Navbar } from '../navbar';
import { Column } from '../column';
import { QACompare } from './sort';
import { LeaderList, getLeaders } from '../leader-list';
import { useMyPullNotification, useMyReviewNotification } from "./notifications"
import { useStyleConfig, Drawer, DrawerContent, Box, SimpleGrid, VStack } from "@chakra-ui/react"
import { ClosedPullCard } from "../pull-card";

export const Pulldasher: React.FC = function() {
   const allPulls = useAllPulls();
   const pulls = useAllOpenPulls();
   const pullsCIBlocked = pulls.filter(pull => pull.isCiBlocked());
   const pullsDeployBlocked = pulls.filter(pull => pull.isDeployBlocked());
   const pullsReady = pulls.filter(pull => pull.isReady() && pull.isCiRequired());
   const pullsDevBlocked = pulls.filter(pull => pull.getDevBlock() || pull.isDraft());
   const pullsNeedingCR = pulls.filter(pull => !pull.isCrDone() && !pull.getDevBlock() && !pull.isDraft());
   const pullsNeedingQA = pulls.filter(pull => !pull.isQaDone() && !pull.getDevBlock() && !pull.isDraft() && pull.hasPassedCI());
   const leadersCR = getLeaders(allPulls, (pull) => pull.status.allCR);
   useMyPullNotification(pullsReady, 'merge');
   useMyReviewNotification([...pullsNeedingCR, ...pullsNeedingQA], 're-review');
   return (<>
      <Navbar mb={4}/>
      <Box maxW="var(--body-max-width)" m="auto" px="var(--body-gutter)">
         <VStack spacing="var(--body-gutter)">
            <LeaderList title="CR Leaders" leaders={leadersCR}/>
            <SimpleGrid minChildWidth='300px' spacing="var(--body-gutter)" w="100%">
               <Box>
                  <Column id="ci" title="CI Blocked" variant="ciBlocked" pulls={pullsCIBlocked}/>
               </Box>
               <Box>
                  <Column id="dep" title="Deploy Blocked" variant="deployBlocked" pulls={pullsDeployBlocked}/>
               </Box>
               <Box>
                  <Column id="ready" title="Ready" variant="ready" pulls={pullsReady}/>
               </Box>
               <Box>
                  <Column id="dev" title="Dev Block" pulls={pullsDevBlocked}/>
               </Box>
               <Box>
                  <Column id="cr" title="CR" pulls={pullsNeedingCR}/>
               </Box>
               <Box>
                  <Column id="qa" title="QA" pulls={pullsNeedingQA.sort(QACompare)}/>
               </Box>
            </SimpleGrid>
         </VStack>
         <ClosedPulls/>
      </Box>
   </>);
}

function ClosedPulls() {
   const closedPulls: Pull[] = Array.from(useAllPulls()).filter(pull => pull.closed_at);
   const styles = useStyleConfig('Column', {variant: "closed"});
   return (
      <Drawer placement="right" isOpen={true} onClose={() => 0}>
         <DrawerContent>
            <Box __css={styles}>
               <Box className="column_header">
                  <Box p={3} pl={4}>Recently Closed Pulls</Box>
               </Box>
               {closedPulls.map(pull =>
                  <ClosedPullCard key={Math.random()} pull={pull} show={true}/>
               )}
            </Box>
         </DrawerContent>
      </Drawer>
   );
}
