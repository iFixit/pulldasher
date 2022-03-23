import { Pull } from '../pull';
import { CommitStatuses } from './commit-statuses';
import { Age } from './age';
import { Flags } from './flags';
import { Signatures } from './signatures';
import { CopyBranch } from './copy-branch';
import { memo } from "react";
import { Flex, Box, Link, chakra } from "@chakra-ui/react"
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
      "& .copy": {
         visibility: "hidden",
      },
      "&:hover .copy": {
         visibility: "visible",
      },
      "& .star": {
         marginRight: "0.5em"
      }
   }
});

const SigsAndFlags = chakra(Flex, {
   baseStyle: {
      mt: 3,
      "& > *": {
         marginRight: "5px",
         marginBottom: "5px",
      }
   }
});

export const PullCard = memo(
function PullCard({pull, show}: {pull: Pull, show: boolean}) {
   return (
      <Card position="relative" display={show ? "" : "none"}>
         <CommitStatuses pull={pull}/>
         <Box>
            <Link href={pull.getUrl()}>
               {pull.isMine() && <FontAwesomeIcon icon={faStar} className="star" color="var(--user-icon)"/>}
               <chakra.span fontWeight="bold">{pull.getRepoName()} #{pull.number}: </chakra.span>
               {pull.title}
            </Link>
            <CopyBranch
               value={pull.head.ref}
               className="copy"
            />
            <SigsAndFlags wrap="wrap">
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
               <Flags pull={pull}/>
            </SigsAndFlags>
            <Age created_at={pull.created_at}/>
         </Box>
      </Card>
   );
});
