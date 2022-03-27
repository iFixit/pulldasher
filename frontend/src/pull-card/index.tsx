import { Pull } from '../pull';
import { CommitStatuses } from './commit-statuses';
import { Age } from './age';
import { Flags } from './flags';
import { Signatures } from './signatures';
import { CopyBranch } from './copy-branch';
import { RefreshButton } from './refresh';
import { Flex, Box, Link, chakra } from "@chakra-ui/react"
import { useEffect, useRef } from "react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar } from '@fortawesome/free-solid-svg-icons'

const Card = chakra(Flex, {
   baseStyle: {
      position: "relative",
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
      "&:hover .refresh": {
         visibility: "visible",
      },
      "& .star": {
         marginRight: "0.5em"
      },
      "&.highlight": {
         animation: "highlightPull 2s",
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

export function PullCard({pull}: {pull: Pull}) {
   const cardRef = useRef<HTMLElement>(null);

   // Animate a highlight when pull.received_at changes
   useEffect(() => {
      cardRef.current?.classList.add("highlight");
      // 1s after the animation, remove the class
      setTimeout(() => cardRef.current?.classList.remove("highlight"), 3000);
   }, [pull.received_at]);

   return (
      <Card ref={cardRef}>
         <RefreshButton pull={pull}/>
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
}
