import { usePulls, useSetFilter } from './pulldasher/pulls-context';
import { Pull } from './pull';
import { Button, HStack, Center, Flex, Box, BoxProps, Input } from "@chakra-ui/react";
import { useEffect, useCallback } from "react";
import { useBoolUrlState } from "./use-url-state";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSnowflake } from '@fortawesome/free-solid-svg-icons'

export function Navbar(props: BoxProps) {
   const pulls: Pull[] = usePulls();
   const setPullFilter = useSetFilter();
   const [showCryo, setShowCryo] = useBoolUrlState('cryo', false);
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
   const toggleShowCryo = useCallback(() => setShowCryo(!showCryo), [showCryo]);
   useEffect(() => setPullFilter('cryo', showCryo ? null : isPullCryo), [showCryo]);

   return (
      <Center py={2} bgColor="var(--header-background)" {...props}>
         <Flex px="var(--body-gutter)" maxW="100%" w="var(--body-max-width)" justify="space-between">
            <HStack alignSelf="center" w="200px" spacing="2">
               <span>{pulls.length} open</span>
               <Button
                  size="sm"
                  title="Show pulls with label Cryogenic Storage"
                  colorScheme="blue"
                  variant={showCryo ? 'solid' : 'ghost'}
                  onClick={toggleShowCryo}>
                  <FontAwesomeIcon icon={faSnowflake}/>
               </Button>
            </HStack>
            <Box alignSelf="center" fontSize={20}>
               <span style={{fontVariantCaps: "small-caps"}}>Pulldasher</span>
               &nbsp;&nbsp;-&nbsp;&nbsp;
               <span style={{fontSize: "12px"}}>
                  back to <a href="/">old ui</a>
               </span>
            </Box>
            <Box w="200px" textAlign="right">
               <Input w={150} onChange={updateSearchFilter} placeholder="Search"/>
            </Box>
         </Flex>
      </Center>
   );
}

function isPullCryo(pull: Pull): boolean {
   return !pull.getLabel("Cryogenic Storage");
}
