import { render } from "react-dom";
import { Page } from "./pulldasher";
import { PullsProvider } from "./pulldasher/pulls-context";
import { ChakraProvider } from "@chakra-ui/react";
import { theme } from "./theme";

/** Redirect on load in order to handle focus gracefully. */
const url = new URL(window.location.href);
const redirect = url.searchParams.get("redirect");
if (redirect) {
  window.focus();
  window.location.href = redirect;
}

const root = document.createElement("div");
document.body.appendChild(root);

function App() {
  return (
    <PullsProvider>
      <ChakraProvider theme={theme}>
        <Page />
      </ChakraProvider>
    </PullsProvider>
  );
}
if (!redirect) {
  render(<App />, root);
}
