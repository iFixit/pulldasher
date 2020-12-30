import * as React from 'react';
import { useContext } from 'react';
import PullsContext from './pulls-context';
import { Pull } from './types';
import Navbar from 'react-bootstrap/Navbar';

export default function() {
   const pulls: Pull[] = useContext(PullsContext).pulls;
   return (
      <Navbar expand="sm">
         <Navbar.Brand>Pulldasher</Navbar.Brand>
         <Navbar.Toggle/>
      </Navbar>
   );
}
