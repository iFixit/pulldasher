import { render } from 'react-dom';
import { Pulldasher } from './pulldasher';
import { PullsProvider } from './pulls-context';
import { ChakraProvider } from "@chakra-ui/react"
import { theme } from './theme';
import '../../views/standard/less/themes/day_theme.less';
import '../../views/standard/less/themes/night_theme.less';

const root = document.createElement("div");
document.body.appendChild(root);

function App() {
   return (
   <PullsProvider>
      <ChakraProvider theme={theme}>
         <Pulldasher/>
      </ChakraProvider>
   </PullsProvider>);
}
render(<App/>, root);
