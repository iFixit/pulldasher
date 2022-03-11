import { Pull } from './pull';
import { Signature, SignatureUser } from './types';
import { HStack, Box, chakra } from "@chakra-ui/react"

interface SigCount {
   user: SignatureUser;
   count: number;
}

export function LeaderList({leaders, title}: {leaders: SigCount[], title: string}) {
   return (
   <Box
      px={6}
      py={2}
      fontSize="1rem"
      bgColor="var(--leaderboard-background)">
      <HStack spacing={2} textAlign="center">
         <chakra.span p={1}>{title}:</chakra.span>
         {leaders.map(({user, count}, i) =>
            <HStack
               overflow="hidden"
               borderRadius="4px"
               fontWeight="bold"
               color="white"
               bg={colorForIndex(i)}
               border={`solid 1px ${colorForIndex(i)}`}
               key={user.login}
               spacing={0}>
               <Avatar user={user}/>
               <chakra.span px="5px" minW="26px">{count}</chakra.span>
            </HStack>
         )}
      </HStack>
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
   const signatures: Signature[] = pulls.flatMap(extractSigsFromPull);
   const users = signatures.map((signature) => signature.data.user);
   const groupedByUsers = users
      .reduce((grouped: Map<number, SigCount>, user: SignatureUser) => {
         const group = grouped.get(user.id) || {user, count:0};
         group.count++;
         grouped.set(user.id, group)
         return grouped;
      }, new Map())
      .values();
   return Array.from(groupedByUsers)
      .sort((a: SigCount, b: SigCount) => b.count - a.count)
      .slice(0, 5);
}
