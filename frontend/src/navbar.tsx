import { FilterMenu } from './filter-menu';
import { usePulls, useAllOpenPulls, useSetFilter } from './pulldasher/pulls-context';
import { Pull } from './pull';
import {
   chakra,
   useColorMode,
   Button,
   HStack,
   Center,
   Flex,
   Box,
   BoxProps,
   Input,
} from "@chakra-ui/react";
import { useRef, useEffect, useCallback } from "react";
import { useBoolUrlState } from "./use-url-state";
import { NotificationRequest } from "./notifications"
import { useConnectionState, ConnectionState } from "./backend/socket";
import { useHotkeys } from 'react-hotkeys-hook';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSnowflake, faMoon, faWifi, faCircleNotch, faXmark, faCircleExclamation, faEyeSlash } from '@fortawesome/free-solid-svg-icons'

// Default width of the left and right sections of the nav bar
const sideWidth = "220px";

export function Navbar(props: BoxProps) {
   const pulls: Set<Pull> = usePulls();
   const allOpenPulls: Pull[] = useAllOpenPulls();
   const setPullFilter = useSetFilter();
   const {toggleColorMode} = useColorMode();
   const [showCryo, setShowCryo] = useBoolUrlState('cryo', false);
   const [showBlocked, setShowBlocked] = useBoolUrlState('external_block', false);
   const hideBelowMedium = ['none', 'none', 'block'];
   const hideBelowLarge = ['none', 'none', 'none', 'block'];

   const toggleShowCryo = useCallback(() => setShowCryo(!showCryo), [showCryo]);
   useEffect(() => setPullFilter('cryo', showCryo ? null : isPullCryo), [showCryo]);

   const toggleShowBlocked = useCallback(() => setShowBlocked(!showBlocked), [showBlocked]);
   useEffect(() => setPullFilter('external_block', showBlocked ? null : isPullBlocked), [showBlocked]);

   return (
      <Center py={2} bgColor="var(--header-background)" color="var(--brand-color)" {...props}>
         <Flex px="var(--body-gutter)" maxW="100%" w="var(--body-max-width)" gap="var(--body-gutter)" justify="space-between">
            <HStack alignSelf="center" flexGrow={1} flexBasis={sideWidth} spacing="2">
               <Box display={hideBelowLarge} p="1 15px 0 0" fontSize="16px">
                  <ConnectionStateIndicator/>
               </Box>
               <chakra.span display={hideBelowLarge} title={`Shown: ${pulls.size} Total: ${allOpenPulls.length}`}>
                  open: {pulls.size}
               </chakra.span>
               <Button
                  display={hideBelowMedium}
                  size="sm"
                  title="Show pulls with label Cryogenic Storage"
                  colorScheme="blue"
                  variant={showCryo ? 'solid' : 'ghost'}
                  onClick={toggleShowCryo}>
                  <FontAwesomeIcon icon={faSnowflake}/>
               </Button>
               <Button
                  display={hideBelowMedium}
                  size="sm"
                  title="Toggle display for externally blocked pull requests"
                  colorScheme="blue"
                  variant={showBlocked ? 'solid' : 'ghost'}
                  onClick={toggleShowBlocked}>
                  <FontAwesomeIcon icon={faEyeSlash}/>
               </Button>
               <Button
                  display={hideBelowMedium}
                  size="sm"
                  title="Dark Mode"
                  colorScheme="blue"
                  variant='ghost'
                  onClick={toggleColorMode}>
                  <FontAwesomeIcon icon={faMoon}/>
               </Button>
               <NotificationRequest />
               <Box>
                  <FilterMenu urlParam="repo" buttonText="Repo" extractValueFromPull={(pull: Pull) => pull.getRepoName()}/>
               </Box>
               <Box>
                  <FilterMenu urlParam="author" buttonText="Author" extractValueFromPull={(pull: Pull) => pull.user.login}/>
               </Box>
            </HStack>
            <Flex alignSelf="center" fontSize={20} flexShrink={0}>
               <span style={{fontVariantCaps: "small-caps"}}>Pulldasher</span>
            </Flex>
            <Box flexBasis={sideWidth} flexGrow={1} flexShrink={1} display="flex" justifyContent="flex-end">
               <SearchInput/>
            </Box>
         </Flex>
      </Center>
   );
}

function isPullCryo(pull: Pull): boolean {
   return !pull.getLabel("Cryogenic Storage");
}

function SearchInput() {
   const setPullFilter = useSetFilter();
   const searchInputRef = useRef<HTMLInputElement>(null);
   const updateSearchFilter = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
      const patterns = event.target.value
         .trim()
         .split(/\s+/)
         .filter((s) => s.length)
         .map((s) => new RegExp(s, 'i'));
      setPullFilter('search', patterns.length ? (pull: Pull) => {
         return patterns.every((pattern) => pull.title.match(pattern));
      }: null);
   }, []);

   useHotkeys('/', (event) => {
      if (searchInputRef.current) {
         searchInputRef.current.focus();
         searchInputRef.current.select();
         event.preventDefault();
      }
   });

   return (
      <Input
         maxWidth={sideWidth}
         w="100%"
         type="search"
         onChange={updateSearchFilter}
         placeholder="Search"
         ref={searchInputRef}
      />
   );
}

function ConnectionStateIndicator() {
   const connectionState = useConnectionState();
   if (connectionState == ConnectionState.connected) {
      return <FontAwesomeIcon icon={faWifi} title="Connected"/>;
   }
   if (connectionState == ConnectionState.connecting) {
      return <FontAwesomeIcon className='fa-spin' icon={faCircleNotch} title="Connecting..."/>;
   }
   if (connectionState == ConnectionState.disconnected) {
      return <FontAwesomeIcon icon={faXmark} title="Disconnected"/>;
   }
   if (connectionState == ConnectionState.error) {
      return <FontAwesomeIcon icon={faCircleExclamation} title="Error" />;
   }
   return null;
}
