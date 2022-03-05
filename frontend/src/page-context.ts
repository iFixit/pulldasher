interface tokenResponse {
   socketToken: string,
   user: string,
}

let pageContext: tokenResponse;

if (process.env.DUMMY_USER) {
   pageContext = {
      user: process.env.DUMMY_USER,
      socketToken: "fake-token",
   };
}

export function getUser() {
   return pageContext && pageContext.user;
}

export default function getPageContext(): Promise<tokenResponse> {
   return fetch("/token")
      .then((response) => response.json())
      .then((response) => pageContext = response);
}
