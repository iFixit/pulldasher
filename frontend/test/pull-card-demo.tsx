import { Pull } from '../src/pull';
import { PullData } from '../src/types';
import { Box, HStack, Heading } from "@chakra-ui/react";
import {
   AgePulls,
   UnfulfilledRequirements,
   PartialRequirements,
   FulfilledRequirements,
   FewStatuses,
   ManyStatuses,
   Blocked,
   Milestones,
   Labels,
} from "./named-pulls";
import { PullCard } from '../src/pull-card';

import { render } from 'react-dom';
import { ChakraProvider } from "@chakra-ui/react"
import { theme } from '../src/theme';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);

function PullCardDemo() {
   return (
      <ChakraProvider theme={theme}>
         <Row title="Different Ages" pullDatas={AgePulls}/>
         <Row title="Unfulfilled Requirements" pullDatas={UnfulfilledRequirements}/>
         <Row title="Partial Requirements" pullDatas={PartialRequirements}/>
         <Row title="Fulfilled Requirements" pullDatas={FulfilledRequirements}/>
         <Row title="Few Commit Statuses" pullDatas={FewStatuses}/>
         <Row title="Many Commit Statuses" pullDatas={ManyStatuses}/>
         <Row title="Blocked" pullDatas={Blocked}/>
         <Row title="Milestones" pullDatas={Milestones}/>
         <Row title="Labels" pullDatas={Labels}/>
      </ChakraProvider>
   );
}

function Row({title, pullDatas}: {title: string, pullDatas: PullData[]}) {
   return (<>
      <Box m={10} maxW={1024}>
         <Heading size="lg">{title}</Heading>
         <HStack spacing={5}>
            {pullDatas.map((pullData, i) =>
               <Box key={i} w="30%" border="1px solid var(--panel-default-border)"  overflow="hidden">
                  <PullCard pull={new Pull(pullData)}/>
               </Box>
            )}
         </HStack>
      </Box>
   </>);
}

render(<PullCardDemo/>, root);
