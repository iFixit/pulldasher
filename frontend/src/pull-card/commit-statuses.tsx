import { Pull } from '../pull';
import { CommitStatus } from '../types';
import { chakra, Box, useStyleConfig } from "@chakra-ui/react"
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
`;

function Status({status}: {status: CommitStatus}) {
   const styles = useStyleConfig('Status', {variant: status.data.state});
   const title = status.data.context + ": " + status.data.description;
   return (status.data.target_url ?
      <chakra.a __css={styles}
         title={title}
         href={status.data.target_url}
         className="build_status"
      /> :
      <Box __css={styles}
         title={title}
         className="build_status"
      />
   );
}

export function CommitStatuses({pull}: {pull: Pull}) {
   return (
   <StatusContainer className="build_status_container">
      {pull.buildStatuses().map((status) =>
         <Status
            status={status}
            key={status.data.context}
         />
      )}
   </StatusContainer>
   );
}
