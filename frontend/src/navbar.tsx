import { usePulls, useSetFilter } from './pulldasher/pulls-context';
import { Pull } from './pull';
import { Center, Flex, Box, BoxProps, Input } from "@chakra-ui/react"

export function Navbar(props: BoxProps) {
   const pulls: Pull[] = usePulls();
   const setPullFilter = useSetFilter();
   const updateFilter = function(event: React.ChangeEvent<HTMLInputElement>) {
      const patterns = event.target.value
         .trim()
         .split(/\s+/)
         .filter((s) => s.length)
         .map((s) => new RegExp(s, 'i'));
      setPullFilter(patterns.length ? (pull: Pull) => {
         return patterns.every((pattern) => pull.title.match(pattern));
      }: null);
   };

   return (
      <Center py={2} bgColor="var(--header-background)" {...props}>
         <Flex px="var(--body-gutter)" w={1024} justify="space-between">
            <Box alignSelf="center" w={150}>{pulls.length} open</Box>
            <Box alignSelf="center" fontSize={20} __css={{fontVariantCaps: "small-caps"}}>Pulldasher</Box>
            <Input alignSelf="center" w={150} onChange={updateFilter} placeholder="Search"/>
         </Flex>
      </Center>
   );
}
