import * as React from 'react';
import * as ReactDOM from 'react-dom';
import PullDasherUI from './pulldasher';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);
ReactDOM.render(<PullDasherUI/>, root);
