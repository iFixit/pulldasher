import { Pull } from '../pull';
import { refreshPull } from '../backend/pull-socket';
import { Box, chakra } from "@chakra-ui/react"
import { useState } from "react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRefresh } from '@fortawesome/free-solid-svg-icons'

const RefreshContainer = chakra(Box, {
   baseStyle: {
      lineHeight: 0.9,
      visibility: "hidden",
      position: "absolute",
      cursor: 'pointer',
      bottom: '3px',
      right: '3px',
      borderRadius: '4px',
      borderWidth: '1px',
      borderColor: 'var(--refresh)',
      padding: "5px",
      background: "white",
      color: "var(--refresh)",
      "&.refreshing": {
         visibility: "visible",
      },
      "&:hover": {
         color: "var(--refresh-hover)",
         borderColor: "var(--refresh-hover)",
      },
      "&:active": {
         color: "white",
         backgroundColor: "var(--refresh-hover)",
      },
   }
});

export function RefreshButton({pull}: {pull: Pull}) {
   const [oldReceivedAt, setOldReceivedAt] = useState<Date|null>(new Date());
   const waitingOnRefreshing = oldReceivedAt == pull.received_at;
   const handleOnClick = () => {
      refreshPull(pull);
      setOldReceivedAt(pull.received_at);
   }
   return (
      <RefreshContainer
         onClick={handleOnClick}
         title="Refresh"
         className={"refresh " + (waitingOnRefreshing ? "refreshing" : undefined)}>
         <FontAwesomeIcon className={waitingOnRefreshing ? "fa-spin" : undefined} icon={faRefresh}/>
      </RefreshContainer>
   );
}
