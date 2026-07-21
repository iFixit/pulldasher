interface tokenResponse {
  socketToken: string;
  user: string;
  title: string;
}

let pageContext: tokenResponse;

if (process.env.DUMMY_USER) {
  pageContext = {
    user: process.env.DUMMY_USER,
    socketToken: "fake-token",
    title: "Pulldasher",
  };
}

export function getUser() {
  return pageContext && pageContext.user;
}

export function getTitle() {
  return pageContext && pageContext.title;
}

export function getPageContext(): Promise<tokenResponse> {
  return fetch("/token")
    .then((response) => response.json())
    .then((response) => (pageContext = response));
}
