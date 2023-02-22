import { Img } from "@chakra-ui/react";
import { userProfileUrl } from "../utils";

export function Avatar({
  user,
  linkToProfile,
}: {
  user: string;
  linkToProfile?: boolean;
}) {
  const cleanUsername = user.replace(/\[bot\]$/, "");
  return (
    <Img
      data-user={user}
      onClick={linkToProfile ? avatarClickHandler : undefined}
      mr="7px"
      mb="1px"
      height="20px"
      width="20px"
      display="inline-block"
      borderRadius="full"
      verticalAlign="bottom"
      title={user}
      src={`https://github.com/${cleanUsername}.png?size=20`}
    />
  );
}

function avatarClickHandler(event: React.MouseEvent<HTMLElement>) {
  const user: string | undefined = event.currentTarget?.dataset.user;
  if (!user) {
    return;
  }
  window.open(userProfileUrl(user), "_blank");
  event.preventDefault();
}
