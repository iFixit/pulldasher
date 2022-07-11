import * as React from "react";
import { Pull } from "./pull";
import { getUser } from "./page-context";
import { Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBellExclamation } from "@fortawesome/free-solid-svg-icons";

type NotificationOptions = {
  filter?: (pull: Pull) => boolean;
  message: (pulls: Pull[], titles: string) => string;
};

const defaults = {
  filter: (pull: Pull) => pull.isMine() || pull.hasOutdatedSig(getUser()),
};

export function useNotification(pulls: Pull[], options: NotificationOptions) {
  const { filter, message } = Object.assign({}, defaults, options);
  const filtered = pulls.filter(filter);
  React.useEffect(() => {
    const titles = filtered.map((p) => p.title).join(", ");
    const msg = message(filtered, titles);
    if (Notification.permission === "granted") {
      new Notification(msg);
    }
  }, [filtered]);
}

export function NotificationRequest() {
  const activateNotifications = () => {
    Notification.requestPermission();
  };
  if (Notification.permission === "default") {
    return (
      <Button
        display={hideBelowMedium}
        size="sm"
        title="Dark Mode"
        colorScheme="blue"
        variant="ghost"
        onClick={activateNotifications}
      >
        <FontAwesomeIcon icon={faBellExclamation} />
      </Button>
    );
  }
  return null;
}
