import { Pull } from './pull';
import { StatusState } from './types';
import { Box, chakra } from "@chakra-ui/react"

const padding = 5;
const height = 10;
const marginBetween = 4;

export const Status = chakra(Box, {
   baseStyle: {
      pos: "relative",
      h: `${height}px`,
      flexGrow: 1,
      borderRadius: "5px",
   }
});

const StatusContainer = chakra(Box, {
   baseStyle: {
      marginBottom: `${padding}px`,
      display: "flex",
      justifyContent: "space-between",
      gap: `${marginBetween}px`,
   }
});

export function CommitStatuses({pull}: {pull: Pull}) {
   return (
   <StatusContainer>
      {pull.buildStatuses().map((status) =>
         <Status
            title={status.data.context + ": " + status.data.description}
            key={status.data.context}
            href={status.data.target_url}
            bg={stateToColor(status.data.state)}
         >
         </Status>
      )}
   </StatusContainer>
   );
}

function stateToColor(state: StatusState) {
   return state === StatusState.success ? "green" :
      state === StatusState.pending ? "orange" :
      state === StatusState.error ? "black" :
      state === StatusState.failure ? "red" : "#ddd;";
}

