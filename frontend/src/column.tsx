import { Pull } from './pull';
import PullCard from './pull-card';
import { Box } from "@chakra-ui/react"

interface ColumnProps {
   pulls: Pull[],
   title: string
}

export function Column(props: ColumnProps) {
   return (
      <Box border="1px" borderRadius={7} overflow="hidden">
         <Box bgColor="var(--panel-default-background)" size="m" p={4}>
            {props.title}
         </Box>
         <Box>
            {props.pulls.map((pull) =>
               <PullCard key={pull.getKey()} pull={pull}/>
            )}
         </Box>
      </Box>
   );
}
