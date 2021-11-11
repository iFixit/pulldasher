import { Pull } from './pull';
import { CommitStatuses } from './commit-statuses';
import { Box, Link } from "@chakra-ui/react"

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <Box borderTop="1px" p={3}>
         <CommitStatuses pull={pull}/>
         <Link href={pull.getUrl()}>{pull.title}</Link>
         <div>
            <span>CRs: {pull.cr_signatures.current.length}</span>&nbsp;
            <span>QAs: {pull.qa_signatures.current.length}</span>
         </div>
      </Box>
   );
}
