import * as React from 'react';
import { useContext } from 'react';
import PullsContext from './pulls-context';
import { Pull } from './types';
import styled from 'styled-components';
import Card from 'react-bootstrap/Card';

export default function() {
   const pulls: Pull[] = useContext(PullsContext).pulls;
   return (
      <Card>
         <Card.Header>CR</Card.Header>
         <Card.Body></Card.Body>
      </Card>
   );
}
