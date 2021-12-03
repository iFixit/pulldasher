import { Pull } from './pull';
import { CommitStatuses } from './commit-statuses';
import { Flex, Box, Link, useStyleConfig, chakra } from "@chakra-ui/react"

const Card = chakra(Flex, {
   baseStyle: {
      p: 2,
      pl: 0,
      borderTop: "1px #ccc solid",
      "&:hover .build_status": {
         opacity: 1
      },
   }
});

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <Card>
         <CommitStatuses pull={pull}/>
         <Box>
            <Link href={pull.getUrl()}>{pull.title}</Link>
            <div>
               <span>CRs: {pull.cr_signatures.current.length}</span>&nbsp;
               <span>QAs: {pull.qa_signatures.current.length}</span>
            </div>
         </Box>
      </Card>
   );
}
