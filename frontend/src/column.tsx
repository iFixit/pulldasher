import { Pull } from './pull';
import PullCard from './pull-card';
import { Box, Flex, Spacer } from "@chakra-ui/react"

interface ColumnProps {
   pulls: Pull[],
   title: string
}

export function Column(props: ColumnProps) {
   return (
      <Box border="1px" borderRadius={7} overflow="hidden">
         <Flex bgColor="var(--panel-default-background)" size="m">
            <Box p={4}>{props.title}</Box>
            <Spacer/>
            <Box p={4} borderLeft="solid 1px rgba(0,0,0,0.3)" >{props.pulls.length}</Box>
         </Flex>
         <Box>
            {props.pulls.map((pull) =>
               <PullCard key={pull.getKey()} pull={pull}/>
            )}
         </Box>
      </Box>
   );
}
