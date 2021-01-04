import * as React from 'react';
import { usePulls } from './pulls-context';
import { Pull } from './types';
import styled from 'styled-components';
import Card from 'react-bootstrap/Card';

export default function() {
   const pulls: Pull[] = usePulls();
   return (
      <Card>
         <Card.Header>CR</Card.Header>
         <Card.Body></Card.Body>
      </Card>
   );
}
