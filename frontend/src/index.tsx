import { render } from 'react-dom';
import { Pulldasher } from './pulldasher';
import { PullsProvider } from './pulls-context';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);

function App() {
   return (
   <PullsProvider>
      <Pulldasher/>
   </PullsProvider>);
}
render(<App/>, root);
