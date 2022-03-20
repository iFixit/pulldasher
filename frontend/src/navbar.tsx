import { usePulls, useSetFilter } from './pulldasher/pulls-context';
import { Pull } from './pull';
import { HStack, Center, Flex, Box, BoxProps, Input } from "@chakra-ui/react";

export function Navbar(props: BoxProps) {
   const pulls: Pull[] = usePulls();
   const setPullFilter = useSetFilter();
   const updateSearchFilter = function(event: React.ChangeEvent<HTMLInputElement>) {
      const patterns = event.target.value
         .trim()
         .split(/\s+/)
         .filter((s) => s.length)
         .map((s) => new RegExp(s, 'i'));
      setPullFilter('search', patterns.length ? (pull: Pull) => {
         return patterns.every((pattern) => pull.title.match(pattern));
      }: null);
   };

   return (
      <Center py={2} bgColor="var(--header-background)" {...props}>
         <Flex px="var(--body-gutter)" w={1024} justify="space-between">
            <HStack alignSelf="center" w="200px" spacing="2">
               <span>{pulls.length} open</span>
            </HStack>
            <Box alignSelf="center" fontSize={20} __css={{fontVariantCaps: "small-caps"}}>Pulldasher</Box>
            <Box w="200px" textAlign="right">
               <Input w={150} onChange={updateSearchFilter} placeholder="Search"/>
            </Box>
         </Flex>
      </Center>
   );
}
