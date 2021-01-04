export default function getPageContext(): Promise<any> {
   return fetch("/token")
      .then((response) => response.json());
}
