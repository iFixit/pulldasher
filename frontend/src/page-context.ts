interface tokenResponse {
   socketToken: string,
   user: string,
}

let pageContext: tokenResponse;

export function getUser() {
   return pageContext && pageContext.user;
}

export default function getPageContext(): Promise<tokenResponse> {
   return fetch("/token")
      .then((response) => response.json())
      .then((response) => pageContext = response);
}
