import { Pull } from './pull';
import ListGroup from 'react-bootstrap/ListGroup';

export default function PullCard({pull}: {pull: Pull}) {
   return (
      <ListGroup.Item as='a' href={pull.getUrl()}>
         {pull.title}
      </ListGroup.Item>
   );
}
