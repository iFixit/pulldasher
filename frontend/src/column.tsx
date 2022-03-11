import { Pull } from './pull';
import { PullCard } from './pull-card';
import { Box, Flex, Spacer, useStyleConfig } from "@chakra-ui/react"

interface ColumnProps {
   variant?: string,
   pulls: Pull[],
   title: string,
}

export function Column(props: ColumnProps) {
   const styles = useStyleConfig('Column', {variant: props.variant});
   return (
      <Box __css={styles} overflow="hidden">
         <Flex className="column_header">
            <Box p={3} pl={4}>{props.title}</Box>
            <Spacer/>
            <Box className="pull_count" p={3}>{props.pulls.length}</Box>
         </Flex>
         <Box>
            {props.pulls.map((pull) =>
               <PullCard key={pull.getKey()} pull={pull}/>
            )}
         </Box>
      </Box>
   );
}
