import { Pull } from '../pull';
import { CommitStatus, StatusState } from '../types';
import { newTab } from "../utils";
import {
   chakra,
   Box,
   useStyleConfig,
   Popover,
   PopoverTrigger,
   PopoverContent,
   PopoverBody,
   PopoverArrow,
   PopoverCloseButton,
   Portal,
} from "@chakra-ui/react"
import { groupBy } from 'lodash-es';
import { memo } from "react"
import styled from "@emotion/styled"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faCircleXmark, faCircleCheck, faClock, IconDefinition } from '@fortawesome/free-solid-svg-icons'

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

const StatusLinkContainer = Box;

function StatusLink({status}: {status: CommitStatus}) {
   const styles = useStyleConfig('StatusLink', {variant: status.data.state});
   const link = status.data.target_url;
   return (
      <StatusLinkContainer
         __css={styles}
         cursor={link ? "pointer" : "auto"}
         onClick={link ? () => newTab(link) : undefined}
      >
         <FontAwesomeIcon size="lg" icon={iconForStatus(status)}/>
         <chakra.span ml="10px" color="black">
            {status.data.context}: {status.data.description}
         </chakra.span>
      </StatusLinkContainer>
   );
}

function iconForStatus(status: CommitStatus): IconDefinition {
   const state = status.data.state;
   return state === StatusState.pending ? faClock
      : state === StatusState.error ? faCircleExclamation
      : state === StatusState.failure ? faCircleXmark
      : faCircleCheck;
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
   <Popover isLazy>
      <PopoverTrigger>
          <StatusContainer className="build_status_container">
             {grouped.success &&
                <StatusGroup
                   key={StatusState.success}
                   statuses={grouped.success} />
             }
             {grouped.pending &&
                <StatusGroup
                   key={StatusState.pending}
                   statuses={grouped.pending} />
             }
             {grouped.failure &&
                <StatusGroup
                   key={StatusState.failure}
                   statuses={grouped.failure} />
             }
             {grouped.error &&
                <StatusGroup
                   key={StatusState.error}
                   statuses={grouped.error} />
             }
          </StatusContainer>
      </PopoverTrigger>
      <Portal>
         <PopoverContent>
            <PopoverArrow />
            <PopoverCloseButton />
            <PopoverBody>
               {statuses.map(status => <StatusLink key={status.data.context} status={status}/>)}
            </PopoverBody>
         </PopoverContent>
      </Portal>
   </Popover>
   );
});
