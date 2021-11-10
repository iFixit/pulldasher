interface tokenResponse {
   socketToken: string
}
export default function getPageContext(): Promise<tokenResponse> {
   return fetch("/token")
      .then((response) => response.json());
}
