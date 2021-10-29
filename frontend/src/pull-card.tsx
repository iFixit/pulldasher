import { Pull } from './pull';
import ListGroup from 'react-bootstrap/ListGroup';
import { CommitStatuses, Status } from './commit-statuses';
import styled from 'styled-components';

const PullCardContainer = styled(ListGroup.Item)`
   border-left: 0;
   border-right: 0;

   &:hover ${Status} {
      display: block;
   }
`;

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <PullCardContainer>
         <CommitStatuses pull={pull}/>
         <a href={pull.getUrl()}>{pull.title}</a>
         <div>
            <span>CRs: {pull.cr_signatures.current.length}</span>&nbsp;
            <span>QAs: {pull.qa_signatures.current.length}</span>
         </div>
      </PullCardContainer>
   );
}
