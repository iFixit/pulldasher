import * as React from "react";
import { Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBellSlash } from "@fortawesome/free-solid-svg-icons";
import { isEqual } from "lodash-es";

type KeyType = number | string;

type NotificationOptions<T> = {
  filter: (x: T) => boolean;
  message: (xs: T[]) => string;
  key: (x: T) => KeyType;
};

export function useNotification<T>(
  xs: T[],
  { filter, message, key }: NotificationOptions<T>
) {
  const [seen, setSeen] = React.useState<KeyType[]>([]);
  const filtered = xs.filter(filter);
  const unseen = filtered.filter((x) => !seen.includes(key(x)));
  React.useEffect(() => {
    if (unseen.length > 0) {
      const msg = message(unseen);
      if (Notification.permission === "granted") {
        new Notification(msg);
        new Audio("/sounds/bell.mp3").play();
      }
    }
    const proposed = filtered.map(key);

    if (!isEqual(seen, proposed)) {
      setSeen(proposed);
    }
  });
}

export function NotificationRequest() {
  const activateNotifications = () => {
    Notification.requestPermission();
  };
  if (Notification.permission === "default") {
    return (
      <Button
        size="sm"
        title="Activate Notifications"
        colorScheme="blue"
        variant="ghost"
        onClick={activateNotifications}
      >
        <FontAwesomeIcon icon={faBellSlash} />
      </Button>
    );
  }
  return null;
}
