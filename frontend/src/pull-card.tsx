import { Pull } from './pull';
import { CommitStatuses } from './commit-statuses';
import { Flex, Box, Link } from "@chakra-ui/react"

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <Box borderTop="1px" p={3} position="relative">
         <CommitStatuses pull={pull}/>
         <Box>
            <Link href={pull.getUrl()}>{pull.title}</Link>
            <div>
               <span>CRs: {pull.cr_signatures.current.length}</span>&nbsp;
               <span>QAs: {pull.qa_signatures.current.length}</span>
            </div>
         </Box>
      </Box>
   );
}
