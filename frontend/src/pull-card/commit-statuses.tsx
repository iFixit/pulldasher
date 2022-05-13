import { Pull } from '../pull';
import { CommitStatus, StatusState } from '../types';
import {
   chakra,
   Box,
   useStyleConfig,
   Popover,
   PopoverTrigger,
   PopoverContent,
   PopoverHeader,
   PopoverBody,
   PopoverArrow,
   PopoverCloseButton,
   Portal,
   VStack,
} from "@chakra-ui/react"
import { groupBy } from 'lodash-es';
import { memo } from "react"
import styled from "@emotion/styled"

const statusSize = 10;
const marginBetween = 4;

const StatusContainer = styled.div`
   position: absolute;
   top: 0;
   left: 0;
   bottom: 0;
   margin: 6px;
   width: ${statusSize}px;
   display: flex;
   flex-shrink: 0;
   flex-direction: column;
   justify-content: space-between;
   gap: ${marginBetween}px;
   cursor: pointer;
`;

function StatusLink({status}: {status: CommitStatus}) {
   const styles = useStyleConfig('StatusLink', {variant: status.data.state});
   const title = status.data.context + ": " + status.data.description;
   return (status.data.target_url ?
      <chakra.a
         __css={styles}
         target="_blank"
         href={status.data.target_url}
         className="build_status">
         {title}
      </chakra.a> :
      <Box __css={styles} title={title} className="build_status">
         {title}
      </Box>
   );
}

function StatusGroup({statuses}: {statuses: CommitStatus[]}) {
   const state = statuses[0].data.state;
   const styles = useStyleConfig('StatusGroup', {variant: state});
   const contexts = statuses.map(status => status.data.context).join("\n");
   const title = `${state}:${statuses.length > 1 ? "\n" : " "}${contexts}`;
   return (
      <Box __css={styles}
         flexBasis={1 + statuses.length}
         title={title}
         className="build_status"
      />
   );
}

export const CommitStatuses = memo(
function CommitStatuses({pull}: {pull: Pull}) {
   const statuses = pull.buildStatusesWithRequired();
   const grouped = groupBy(statuses, (status) => status.data.state);
   return (
   <Popover>
      <PopoverTrigger>
          <StatusContainer className="build_status_container">
             {Object.keys(grouped).map((state: StatusState) => (
                <StatusGroup
                   key={state}
                   statuses={grouped[state]} />
             ))}
          </StatusContainer>
      </PopoverTrigger>
      <Portal>
         <PopoverContent>
            <PopoverArrow />
            <PopoverCloseButton />
            <PopoverHeader>CI Statuses</PopoverHeader>
            <PopoverBody>
               <VStack spacing="5px">
                  {statuses.map(status => <StatusLink key={status.data.context} status={status}/>)}
               </VStack>
            </PopoverBody>
         </PopoverContent>
      </Portal>
   </Popover>
   );
});
