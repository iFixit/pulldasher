import { Pull } from "../pull";
import {
  Box
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

export function Participants({ pull }: { pull: Pull }) {
  if (!pull.participants?.length) {
    return null;
  }
  return (
    <Box position="absolute" top="2px" right="5px">
      <FontAwesomeIcon
        icon={pull.participants.length > 1 ? faUsers : faUser}
        title={tooltip(pull)}
        color={pull.participating() ? "var(--participants-including-me)" : "var(--participants-without-me)"}
      />
    </Box>
  );
}

function tooltip(pull: Pull) {
   if (pull.participants.length == 1) {
      return pull.participating() ?
         "Only you participating" :
         "1 participant"
   } else {
      return pull.participating() ?
         `${pull.participants.length} participants (including you)` :
         `${pull.participants.length} participants`;
   }
}

