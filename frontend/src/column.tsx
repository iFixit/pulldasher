import { Pull } from './pull';
import { PullCard } from './pull-card';
import { useBoolUrlState } from './use-url-state';
import { Box, Flex, Spacer, useStyleConfig } from "@chakra-ui/react"

interface ColumnProps {
   variant?: string,
   pulls: Pull[],
   title: string,
   id: string,
}

export function Column(props: ColumnProps) {
   const [open, setOpen] = useBoolUrlState(props.id, true);
   const styles = useStyleConfig('Column', {variant: props.variant});
   return (
      <Box __css={styles} overflow="hidden">
         <Flex className="column_header" onClick={() => setOpen(!open)}>
            <Box p={3} pl={4}>{props.title}</Box>
            <Spacer/>
            <Box className="pull_count" p={3}>{props.pulls.length}</Box>
         </Flex>
         <Box display={open ? 'block' : 'none'}>
            {props.pulls.map((pull) =>
               <PullCard key={pull.getKey()} pull={pull}/>
            )}
         </Box>
      </Box>
   );
}
