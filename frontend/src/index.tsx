import { render } from 'react-dom';
import { Pulldasher } from './pulldasher';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);
render(<Pulldasher/>, root);
