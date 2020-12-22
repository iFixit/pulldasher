import * as React from 'react';
import { useState } from 'react';

var pulls = [];

export default function() {
   const [pullState, setPullsState] = useState(pulls);
   return pullState;
};
