import * as React from 'react';
import { useContext } from 'react';
import PullsContext from './pulls-context';
import { Pull } from './types';
import Navbar from 'react-bootstrap/Navbar';
import styled from 'styled-components';

const Brand = styled(Navbar.Brand)`
   width: 200px;
   position: absolute;
   margin: auto;
   left: 0;
   right: 0;
`;

export default function() {
   const pulls: Pull[] = useContext(PullsContext).pulls;
   return (
      <Navbar bg="dark" expand="sm" variant="dark">
         <Navbar.Text>{pulls.length} open</Navbar.Text>
         <Brand>Pulldasher</Brand>
         <Navbar.Toggle/>
      </Navbar>
   );
}
