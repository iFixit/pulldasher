import { usePulls, useSetFilter } from './pulls-context';
import { Pull } from './pull';
import { Center, Flex, Box, BoxProps, Input } from "@chakra-ui/react"

export function Navbar(props: BoxProps) {
   const pulls: Pull[] = usePulls();
   const setPullFilter = useSetFilter();
   const updateFilter = function(event: React.ChangeEvent<HTMLInputElement>) {
      const pattern = event.target.value;
      setPullFilter((pull: Pull) => {
         return pull.title.includes(pattern);
      });
   };

   return (
      <Center pl="var(--body-gutter)" pr="var(--body-gutter)" py={2} bgColor="var(--header-background)" {...props}>
         <Flex w={1024} justify="space-between">
            <Box alignSelf="center" w={150}>{pulls.length} open</Box>
            <Box alignSelf="center">PULLDASHER</Box>
            <Input alignSelf="center" w={150} onChange={updateFilter} placeholder="Search"/>
         </Flex>
      </Center>
   );
}
