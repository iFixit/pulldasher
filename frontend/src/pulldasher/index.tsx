import { useAllPulls, useAllOpenPulls } from './pulls-context';
import { Pull } from '../pull';
import { Navbar } from '../navbar';
import { Column } from '../column';
import { QACompare } from './sort';
import { LeaderList, getLeaders } from '../leader-list';
import { useMyPullNotification, useMyReviewNotification } from "./notifications"
import { Box, SimpleGrid, VStack } from "@chakra-ui/react"
import { useBoolUrlState } from "../use-url-state";
import { ClosedPulls } from '../closed-pulls';

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
   const [showClosedPulls, toggleShowClosedPulls] = useBoolUrlState("closed", false);
   useMyPullNotification(pullsReady, 'merge');
   useMyReviewNotification([...pullsNeedingCR, ...pullsNeedingQA], 're-review');
   return (<>
      <Navbar mb={4} toggleShowClosedPulls={toggleShowClosedPulls} showClosedPulls={showClosedPulls}/>
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
         {showClosedPulls && <ClosedPulls onClickClose={toggleShowClosedPulls}/>}
      </Box>
   </>);
}
