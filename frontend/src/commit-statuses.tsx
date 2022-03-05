import { Pull } from './pull';
import { chakra, useStyleConfig} from "@chakra-ui/react"
import styled from "@emotion/styled"

const statusSize = 10;
const marginBetween = 4;

const Status = chakra.a;

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

export function CommitStatuses({pull}: {pull: Pull}) {
   return (
   <StatusContainer className="build_status_container">
      {pull.buildStatuses().map((status) => {
         const styles = useStyleConfig('Status', {variant: status.data.state});
         return (<Status __css={styles}
            key={status.data.context}
            title={status.data.context + ": " + status.data.description}
            href={status.data.target_url}
            className="build_status"
         />)
      })}
   </StatusContainer>
   );
}
