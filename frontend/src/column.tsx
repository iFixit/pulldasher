import { Pull } from './pull';
import styled from 'styled-components';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import PullCard from './pull-card';

const ColumnBody = styled(Card.Body)`
   padding: 0;
`;

interface ColumnProps {
   pulls: Pull[],
   title: string
}

export function Column(props: ColumnProps) {
   return (
      <Card>
         <Card.Header>{props.title}</Card.Header>
         <ColumnBody>
            <ListGroup>
               {props.pulls.map((pull) =>
                  <PullCard key={pull.getKey()} pull={pull}/>
               )}
            </ListGroup>
         </ColumnBody>
      </Card>
   );
}
