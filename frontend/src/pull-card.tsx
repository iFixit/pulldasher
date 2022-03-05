import { Pull } from './pull';
import { CommitStatuses } from './commit-statuses';
import { Signatures } from './signatures';
import { Flex, Box, Link, HStack, chakra } from "@chakra-ui/react"

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
            <HStack>
               <Signatures
                  pull={pull}
                  signatures={pull.cr_signatures}
                  required={pull.status.cr_req}
                  title="CR"/>
               <Signatures
                  pull={pull}
                  signatures={pull.qa_signatures}
                  required={pull.status.qa_req}
                  title="QA"/>
            </HStack>
         </Box>
      </Card>
   );
}
