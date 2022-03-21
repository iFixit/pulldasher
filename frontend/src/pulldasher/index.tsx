import { usePulls } from './pulls-context';
import { Pull } from '../pull';
import { Navbar } from '../navbar';
import { Column } from '../column';
import { LeaderList, getLeaders } from '../leader-list';
import { Box, SimpleGrid, VStack } from "@chakra-ui/react"

export const Pulldasher: React.FC = function() {
   const pulls: Pull[] = usePulls();
   const pullsCIBlocked = pulls.filter(pull => pull.isCiBlocked());
   const pullsDeployBlocked = pulls.filter(pull => pull.isDeployBlocked());
   const pullsReady = pulls.filter(pull => pull.isReady());
   const pullsDevBlocked = pulls.filter(pull => pull.getDevBlock());
   const pullsNeedingCR = pulls.filter(pull => !pull.isCrDone());
   const pullsNeedingQA = pulls.filter(pull => !pull.isQaDone());
   const leadersCR = getLeaders(pulls, (pull) => pull.cr_signatures.current);
   const leadersQA = getLeaders(pulls, (pull) => pull.qa_signatures.current);
   return (<>
      <Navbar mb={4}/>
      <Box maxW={1024} m="auto" px="var(--body-gutter)">
         <VStack spacing="var(--body-gutter)">
            <SimpleGrid w="100%" columns={2} spacing="var(--body-gutter)">
               <LeaderList title="CR Leaders" leaders={leadersCR}/>
               <LeaderList title="QA Leaders" leaders={leadersQA}/>
            </SimpleGrid>
            <SimpleGrid columns={3} spacing="var(--body-gutter)" w="100%">
               <Box>
                  <Column id="ci" title="CI Blocked" variant="ciBlocked" pulls={pullsCIBlocked}/>
               </Box>
               <Box>
                  <Column id="dep" title="Deploy Blocked" variant="deployBlocked" pulls={pullsDeployBlocked}/>
               </Box>
               <Box>
                  <Column id="ready" title="Ready" variant="ready" pulls={pullsReady}/>
               </Box>
            </SimpleGrid>
            <SimpleGrid columns={3} spacing="var(--body-gutter)" w="100%">
               <Box>
                  <Column id="dev" title="Dev Block" pulls={pullsDevBlocked}/>
               </Box>
               <Box>
                  <Column id="cr" title="CR" pulls={pullsNeedingCR}/>
               </Box>
               <Box>
                  <Column id="qa" title="QA" pulls={pullsNeedingQA}/>
               </Box>
            </SimpleGrid>
         </VStack>
      </Box>
   </>);
}
