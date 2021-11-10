import { Pull } from './pull';
import styled from 'styled-components';

const padding = 5;
const width = 10;
const marginBetween = 4;

export const Status = styled.a`
   width: 100%;
   height: 100%;
   margin: ${marginBetween / 2}px 0;
   border-radius: 5px;
   background: green;
   display: none;
`;

const StatusContainer = styled.div`
   position: absolute;
   left: ${padding}px;
   top: ${padding}px;
   bottom: ${padding}px;
   width: ${width}px;
   display: flex;
   justify-content: flex-start;
   flex-direction: column;
`;

export function CommitStatuses({pull}: {pull: Pull}) {
   return (
   <StatusContainer>
      {pull.status.commit_statuses.map((status) => 
         <Status key={status.data.context} href={status.data.target_url}>
         </Status>
      )}
   </StatusContainer>
   );
}

