import { usePulls } from './pulls-context';
import { Pull } from '../pull';
import { Navbar } from '../navbar';
import { Column } from '../column';
import { Box, SimpleGrid } from "@chakra-ui/react"

export const Pulldasher: React.FC = function() {
   const pulls: Pull[] = usePulls();
   const pullsCIBlocked = pulls.filter(pull => pull.isCiBlocked());
   const pullsDeployBlocked = pulls.filter(pull => pull.isDeployBlocked());
   const pullsReady = pulls.filter(pull => pull.isReady());
   const pullsDevBlocked = pulls.filter(pull => pull.isDevBlocked());
   const pullsNeedingCR = pulls.filter(pull => !pull.isCrDone());
   const pullsNeedingQA = pulls.filter(pull => !pull.isQaDone());
   return (<>
      <Navbar mb={4}/>
      <Box maxW={1024} m="auto" px="var(--body-gutter)">
      <SimpleGrid columns={3} spacing="var(--body-gutter)">
         <Box>QA Leaderboard</Box>
         <Box>CR Leaderboard</Box>
      </SimpleGrid>
      <SimpleGrid columns={3} spacing="var(--body-gutter)">
         <Box>
            <Column title="CI Blocked" variant="ciBlocked" pulls={pullsCIBlocked}/>
         </Box>
         <Box>
            <Column title="Deploy Blocked" variant="deployBlocked" pulls={pullsDeployBlocked}/>
         </Box>
         <Box>
            <Column title="Ready" variant="ready" pulls={pullsReady}/>
         </Box>
      </SimpleGrid>
      <SimpleGrid columns={3} spacing="var(--body-gutter)">
         <Box>
            <Column title="Dev Block" pulls={pullsDevBlocked}/>
         </Box>
         <Box>
            <Column title="CR" pulls={pullsNeedingCR}/>
         </Box>
         <Box>
            <Column title="QA" pulls={pullsNeedingQA}/>
         </Box>
      </SimpleGrid>
      </Box>
   </>);
}
