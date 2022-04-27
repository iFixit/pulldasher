import { Pull } from './pull';
import { toDateString } from './utils';
import { Signature, SignatureUser } from './types';
import { Flex, HStack, Box, chakra } from "@chakra-ui/react"

interface SigCount {
   user: SignatureUser;
   count: number;
}

const DAYS_TO_EXAMINE = 14;

export function LeaderList({leaders, title}: {leaders: SigCount[], title: string}) {
   return (
   <Box
      px={6}
      py={2}
      fontSize="1rem"
      color="var(--leaderboard-title-text)"
      bgColor="var(--leaderboard-background)">
      <Flex textAlign="center" align="center" overflow="hidden" wrap="wrap" maxHeight={27}>
         <chakra.span mb={1} flexShrink={0}>{title}:</chakra.span>
         {leaders.map(({user, count}, i) =>
            <HStack
               overflow="hidden"
               borderRadius="4px"
               fontWeight="bold"
               mb={1}
               ml={2}
               color="white"
               bg={colorForIndex(i)}
               border={`solid 1px ${colorForIndex(i)}`}
               key={user.login}
               flexShrink={0}
               spacing={0}>
               <Avatar user={user}/>
               <chakra.span px="5px" minW="26px">{count}</chakra.span>
            </HStack>
         )}
      </Flex>
   </Box>);
}

function Avatar({user}: {user: SignatureUser}) {
   return <img height={25} width={25} src={`https://avatars.githubusercontent.com/u/${user.id}?s=25`}/>;
}

function colorForIndex(index: number): string {
   return index < 2 ?
      "var(--leaderboard-leader-background)" :
      "var(--leaderboard-posting-background)";
}

export function getLeaders(pulls: Pull[], extractSigsFromPull: (pull: Pull) => Signature[]) {
   const recent = toDateString(new Date(Date.now() - 86400 * 1000 * DAYS_TO_EXAMINE));
   const recentPulls = pulls.filter((pull) => {
      return pull.merged_at ? pull.merged_at > recent : true;
   });
   const sigCounts = new Map<number, SigCount>();
   recentPulls.forEach((pull) => {
      const sigs: Signature[] = extractSigsFromPull(pull);
      const recentSigs = sigs.filter((sig) => sig.data.created_at > recent);
      // Count one sig per user from this pull
      const seenUsers = new Set<number>();
      recentSigs.forEach((sig) => {
         const user = sig.data.user;
         if (seenUsers.has(user.id)) {
            return;
         }
         seenUsers.add(user.id);
         const sigCount = sigCounts.get(user.id) || {user, count:0};
         sigCount.count++;
         sigCounts.set(user.id, sigCount)
      });
   });
   return Array.from(sigCounts.values())
      .sort((a: SigCount, b: SigCount) => b.count - a.count);
}
