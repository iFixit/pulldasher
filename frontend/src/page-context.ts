export default function getPageContext(): Promise<any> {
   return fetch(process.env.BACKEND_URL + "/token")
      .then((response) => response.json());
}
