import { usePulls } from './pulls-context';
import { Pull } from './pull';
import styled from 'styled-components';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import PullCard from './pull-card';

const ColumnBody = styled(Card.Body)`
   padding: 0;
`;

export default function() {
   const pulls: Pull[] = usePulls();
   const pullsNeedingCR = pulls.filter(pull => pull.isCrDone());
   return (
      <Card>
         <Card.Header>CR {pullsNeedingCR.length}</Card.Header>
         <ColumnBody>
            <ListGroup>
               {pullsNeedingCR.map((pull) =>
                  <PullCard key={pull.getKey()} pull={pull}/>
               )}
            </ListGroup>
         </ColumnBody>
      </Card>
   );
}
