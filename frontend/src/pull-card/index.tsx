import { Pull } from '../pull';
import { userProfileUrl } from '../utils';
import { CommitStatuses } from './commit-statuses';
import { Age } from './age';
import { Flags } from './flags';
import { Signatures } from './signatures';
import { CopyBranch } from './copy-branch';
import { memo, useEffect, useRef } from "react";
import { RefreshButton } from './refresh';
import { Flex, Box, Link, chakra, Img } from "@chakra-ui/react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar } from '@fortawesome/free-solid-svg-icons'

const Card = chakra(Flex, {
   baseStyle: {
      position: "relative",
      p: 4,
      pl: 6,
      borderTop: "1px var(--pull-separator) solid",
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

export const PullCard = memo(
function PullCard({pull, show}: {pull: Pull, show: boolean}) {
   const cardRef = useRef<HTMLElement>(null);

   // Animate a highlight when pull.received_at changes
   useEffect(() => {
      cardRef.current?.classList.add("highlight");
      // 1s after the animation, remove the class
      setTimeout(() => cardRef.current?.classList.remove("highlight"), 3000);
   }, [pull.received_at]);

   return (
      <Card ref={cardRef} display={show ? undefined : "none"}>
         <RefreshButton pull={pull}/>
         <CommitStatuses pull={pull}/>
         <Box>
            <Link href={pull.getUrl()} title={pull.user.login} isExternal color="var(--pull-title)">
               {pull.isMine() ?
               <FontAwesomeIcon icon={faStar} className="star" color="var(--user-icon)"/> :
               <Avatar user={pull.user.login}/>}
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

function Avatar({user}: {user: string}) {
   const cleanUsername = user.replace(/\[bot\]$/, "");
   return <Img
      data-user={user}
      onClick={avatarClickHandler}
      mr="7px"
      mb="1px"
      height="20px"
      width="20px"
      display="inline-block"
      borderRadius="full"
      verticalAlign="bottom"
      title={user}
      src={`https://github.com/${cleanUsername}.png?size=20`}
   />;
}

function avatarClickHandler(event: React.MouseEvent<HTMLElement>) {
   const user: string | undefined = event.currentTarget?.dataset.user;
   if (!user) {
      return;
   }
   window.open(userProfileUrl(user), "_blank");
   event.preventDefault();
}
