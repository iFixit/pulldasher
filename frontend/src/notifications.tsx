import * as React from "react";
import { Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBellSlash,
  faVolumeHigh,
  faVolumeXmark,
} from "@fortawesome/free-solid-svg-icons";
import { isEqual } from "lodash-es";

type KeyType = number | string;

type NotificationOptions<T> = {
  filter: (x: T) => boolean;
  message: (xs: T[]) => string;
  key: (x: T) => KeyType;
};

const notificationsSupported = "Notification" in window;

function isBellActive() {
  return window.localStorage.getItem("bell") === "ring";
}

export function useNotification<T>(
  xs: T[],
  { filter, message, key }: NotificationOptions<T>
) {
  if (!notificationsSupported) {
    return;
  }
  const [seen, setSeen] = React.useState<KeyType[]>([]);
  const filtered = xs.filter(filter);
  const unseen = filtered.filter((x) => !seen.includes(key(x)));
  React.useEffect(() => {
    if (unseen.length > 0) {
      const msg = message(unseen);
      if (Notification.permission === "granted") {
        new Notification(msg);
        if (isBellActive()) {
          new Audio("/public/sounds/bell.mp3").play();
        }
      }
    }
    const proposed = filtered.map(key);

    if (!isEqual(seen, proposed)) {
      setSeen(proposed);
    }
  });
}

export function NotificationRequest() {
  const [bellActive, setBellActive] = React.useState(isBellActive());

  const activateBell = () => {
    window.localStorage.setItem("bell", "ring");
    setBellActive(true);
  };

  const deactivateBell = () => {
    window.localStorage.removeItem("bell");
    setBellActive(false);
  };

  const activateNotifications = () => {
    Notification.requestPermission();
  };

  if (!notificationsSupported) {
    return null;
  }
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

  if (bellActive) {
    return (
      <Button
        size="sm"
        title="Deactivate Bell"
        colorScheme="blue"
        variant="ghost"
        onClick={deactivateBell}
      >
        <FontAwesomeIcon icon={faVolumeXmark} />
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      title="Activate Bell"
      colorScheme="blue"
      variant="ghost"
      onClick={activateBell}
    >
      <FontAwesomeIcon icon={faVolumeHigh} />
    </Button>
  );
}
