import { usePulls } from './pulls-context';
import { Pull } from './pull';
import { Center, Flex, Box, BoxProps } from "@chakra-ui/react"

export function Navbar(props: BoxProps) {
   const pulls: Pull[] = usePulls();
   return (
      <Center p={2} bgColor="var(--header-background)" {...props}>
         <Flex w={1024} justify="space-between">
            <Box alignSelf="center" w={150}>{pulls.length} open</Box>
            <Box alignSelf="center">PULLDASHER</Box>
            <Box alignSelf="center" w={150}></Box>
         </Flex>
      </Center>
   );
}
