import { usePulls } from './pulls-context';
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

const PulldasherNav = styled(Navbar)`
   background: var(--header-background);
`;

export default function() {
   const pulls: Pull[] = usePulls();
   return (
      <PulldasherNav expand="sm">
         <Navbar.Text>{pulls.length} open</Navbar.Text>
         <Brand>Pulldasher</Brand>
         <Navbar.Toggle/>
      </PulldasherNav>
   );
}
