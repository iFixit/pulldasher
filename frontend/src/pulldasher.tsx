import * as React from 'react';
import usePullsState from './pulls-state';
import PullsContext from './pulls-context';
import { Pull } from './types';
import Navbar from './navbar';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

export default function() {
   const pulls: Pull[] = usePullsState();
   return (<PullsContext.Provider value={{pulls:pulls}}>
      <Navbar/>
      <Container>
         <Row>
            <Col>QA Leaderboard</Col>
            <Col>CR Leaderboard</Col>
         </Row>
         <Row>
            <Col>CI Blocked</Col>
            <Col>Deploy Blocked</Col>
            <Col>Ready</Col>
         </Row>
         <Row>
            <Col>Dev Blocked</Col>
            <Col>CR</Col>
            <Col>QA</Col>
         </Row>
      </Container>
   </PullsContext.Provider>);
}
