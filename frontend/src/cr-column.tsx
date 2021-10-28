import { usePulls } from './pulls-context';
import { Pull } from './pull';
import styled from 'styled-components';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import PullCard from './pull-card';

export default function() {
   const pulls: Pull[] = usePulls();
   return (
      <Card>
         <Card.Header>CR {pulls.length}</Card.Header>
         <Card.Body>
            <ListGroup>
               {pulls.map((pull) =>
                  <PullCard key={pull.getKey()} pull={pull}/>
               )}
            </ListGroup>
         </Card.Body>
      </Card>
   );
}
