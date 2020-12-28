import * as React from 'react';
import { useState } from 'react';

var pulls = process.env.DUMMY_PULLS || [];

export default function() {
   const [pullState, setPullsState] = useState(pulls);
   return pullState;
};
