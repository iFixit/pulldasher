import { Pull } from './pull';
import ListGroup from 'react-bootstrap/ListGroup';

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <ListGroup.Item as='a' href={pull.getUrl()}>
         {pull.title}
         <div>
            <span>CRs: {pull.cr_signatures.current.length}</span>&nbsp;
            <span>QAs: {pull.qa_signatures.current.length}</span>
         </div>
      </ListGroup.Item>
   );
}
