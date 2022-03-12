import { Pull } from '../src/pull';
import { Box, SimpleGrid, useStyleConfig } from "@chakra-ui/react";
import { NamedPulls } from "./named-pulls";
import { PullCard } from '../src/pull-card';

import { render } from 'react-dom';
import { ChakraProvider } from "@chakra-ui/react"
import { theme } from '../src/theme';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);

function PullCardDemo() {
   const styles = useStyleConfig('Column');
   const pull = new Pull(NamedPulls["Needs CR"]);
   return (
      <ChakraProvider theme={theme}>
      <Box __css={styles} overflow="hidden" mb="var(--body-gutter)">
         <Box>
            <PullCard pull={pull}/>
         </Box>
      </Box>
      </ChakraProvider>
   );
}
render(<PullCardDemo/>, root);
