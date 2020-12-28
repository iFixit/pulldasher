import * as React from 'react';
import { useState } from 'react';
import { Pull } from  './types';

var pulls: Record<string, Pull> = {};
var dummyPulls: Pull[] = (process.env.DUMMY_PULLS || []) as Pull[];
dummyPulls.forEach(storePull);

function storePull(pull: Pull) {
   const pullKey = pull.repo + "#" + pull.number;
   pulls[pullKey] = pull;
}

export default function(): Pull[] {
   const [pullState, setPullsState] = useState(Object.values(pulls));
   return pullState;
};
