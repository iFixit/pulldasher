import { render } from 'react-dom';
import PullDasherUI from './pulldasher';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);
render(<PullDasherUI/>, root);
