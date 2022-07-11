import * as React from "react";
import { Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBellSlash } from "@fortawesome/free-solid-svg-icons";

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
  const unseen = xs.filter((x) => !seen.includes(key(x)));
  const filtered = unseen.filter(filter);
  React.useEffect(() => {
    if (filtered.length > 0) {
      const msg = message(filtered);
      if (Notification.permission === "granted") {
        new Notification(msg);
        setSeen((seen) => [...seen, ...filtered.map(key)]);
      }
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
