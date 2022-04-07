import { FilterMenu } from './filter-menu';
import { usePulls, useSetFilter } from './pulldasher/pulls-context';
import { Pull } from './pull';
import { useColorMode, Button, HStack, Center, Flex, Box, BoxProps, Input } from "@chakra-ui/react";
import { useEffect, useCallback } from "react";
import { useBoolUrlState } from "./use-url-state";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSnowflake, faMoon } from '@fortawesome/free-solid-svg-icons'

// Default width of the left and right sections of the nav bar
const sideWidth = "220px";

export function Navbar(props: BoxProps) {
   const pulls: Set<Pull> = usePulls();
   const setPullFilter = useSetFilter();
   const {toggleColorMode} = useColorMode();
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
      <Center py={2} bgColor="var(--header-background)" color="var(--brand-color)" {...props}>
         <Flex px="var(--body-gutter)" maxW="100%" w="var(--body-max-width)" gap="var(--body-gutter)" justify="space-between">
            <HStack alignSelf="center" flexGrow="1" flexBasis={sideWidth} spacing="2">
               <span>{pulls.size} open</span>
               <Button
                  size="sm"
                  title="Show pulls with label Cryogenic Storage"
                  colorScheme="blue"
                  variant={showCryo ? 'solid' : 'ghost'}
                  onClick={toggleShowCryo}>
                  <FontAwesomeIcon icon={faSnowflake}/>
               </Button>
               <Button
                  size="sm"
                  title="Dark Mode"
                  colorScheme="blue"
                  variant='ghost'
                  onClick={toggleColorMode}>
                  <FontAwesomeIcon icon={faMoon}/>
               </Button>
               <FilterMenu urlParam="repo" buttonText="Repo" extractValueFromPull={(pull: Pull) => pull.getRepoName()}/>
            </HStack>
            <Box alignSelf="center" fontSize={20} flexShrink="0">
               <span style={{fontVariantCaps: "small-caps"}}>Pulldasher</span>
               &nbsp;&nbsp;-&nbsp;&nbsp;
               <span style={{fontSize: "12px"}}>
                  back to <a href="/">old ui</a>
               </span>
            </Box>
            <Box flexBasis={sideWidth} flexGrow="1" flexShrink="1" textAlign="right">
               <Input w="100%" maxWidth={sideWidth} onChange={updateSearchFilter} placeholder="Search"/>
            </Box>
         </Flex>
      </Center>
   );
}

function isPullCryo(pull: Pull): boolean {
   return !pull.getLabel("Cryogenic Storage");
}
