import usePullsState from './pulls-state';
import PullsContext from './pulls-context';
import { ChakraProvider } from "@chakra-ui/react"
import { Pull } from './pull';
import Navbar from './navbar';
import { Column } from './column';
import { Box, SimpleGrid } from "@chakra-ui/react"

export default function Pulldasher() {
   const pulls: Pull[] = usePullsState();
   const pullsCIBlocked = pulls.filter(pull => pull.isCiBlocked());
   const pullsDeployBlocked = pulls.filter(pull => pull.isDeployBlocked());
   const pullsReady = pulls.filter(pull => pull.isReady());
   const pullsDevBlocked = pulls.filter(pull => pull.isDevBlocked());
   const pullsNeedingCR = pulls.filter(pull => !pull.isCrDone());
   const pullsNeedingQA = pulls.filter(pull => !pull.isQaDone());
   return (<ChakraProvider>
      <PullsContext.Provider value={{pulls:pulls}}>
         <Navbar mb={4}/>
         <Box maxW={1024} m="auto">
         <SimpleGrid columns={3} spacing={6}>
            <Box>QA Leaderboard</Box>
            <Box>CR Leaderboard</Box>
         </SimpleGrid>
         <SimpleGrid columns={3} spacing={6}>
            <Box>
               <Column title="CI Blocked" pulls={pullsCIBlocked}/>
            </Box>
            <Box>
               <Column title="Deploy Blocked" pulls={pullsDeployBlocked}/>
            </Box>
            <Box>
               <Column title="Ready" pulls={pullsReady}/>
            </Box>
         </SimpleGrid>
         <SimpleGrid columns={3} spacing={6}>
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
      </PullsContext.Provider>
   </ChakraProvider>);
}
