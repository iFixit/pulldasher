import { Pull } from './pull';
import { CommitStatuses } from './commit-statuses';
import { Signatures } from './signatures';
import { Flex, Box, Link, HStack, chakra } from "@chakra-ui/react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar } from '@fortawesome/free-solid-svg-icons'

const Card = chakra(Flex, {
   baseStyle: {
      p: 4,
      pl: 6,
      borderTop: "1px #ccc solid",
      "&:hover .build_status": {
         opacity: 1
      },
      "& .star": {
         marginRight: "0.5em"
      }
   }
});

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <Card position="relative">
         <CommitStatuses pull={pull}/>
         <Box>
            <Link href={pull.getUrl()}>
               {pull.isMine() && <FontAwesomeIcon icon={faStar} className="star" color="var(--user-icon)"/>}
               <chakra.span fontWeight="bold">{pull.getRepoName()} #{pull.number}: </chakra.span>
               {pull.title}
            </Link>
            <HStack mt={3}>
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
