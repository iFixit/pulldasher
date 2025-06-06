import { FilterMenu } from "./filter-menu";
import { getTitle } from "./page-context";
import {
  useFilteredOpenPulls,
  useAllOpenPulls,
  useSetFilter,
  useRepoSpecs,
} from "./pulldasher/pulls-context";
import { Pull } from "./pull";
import {
  useColorMode,
  Button,
  HStack,
  Center,
  Flex,
  Box,
  BoxProps,
  Input,
  Menu,
  MenuButton,
  MenuItemOption,
  MenuList,
  Text
} from "@chakra-ui/react";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useBoolUrlState } from "./use-url-state";
import { NotificationRequest } from "./notifications";
import { useConnectionState, ConnectionState } from "./backend/socket";
import { useHotkeys } from "react-hotkeys-hook";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMoon,
  faCodeMerge,
  faWifi,
  faCircleNotch,
  faXmark,
  faCircleExclamation,
  faUser,
  faUsers
} from "@fortawesome/free-solid-svg-icons";

// Default width of the left and right sections of the nav bar
const sideWidth = "220px";

type NavBarProps = BoxProps & {
  toggleShowClosedPulls: () => void;
  showClosedPulls: boolean;
};

export function Navbar(props: NavBarProps) {
  const { toggleShowClosedPulls, showClosedPulls, ...boxProps } = props;
  const pulls: Set<Pull> = useFilteredOpenPulls();
  const allOpenPulls: Pull[] = useAllOpenPulls();
  const setPullFilter = useSetFilter();
  const repoSpecs = useRepoSpecs();
  const reposToHide = useMemo(() =>
    repoSpecs.filter((repo) => repo.hideByDefault).map((repo) => repo.name.replace(/.*\//g, "")),
    [repoSpecs]);
  const { toggleColorMode } = useColorMode();
  const [showCryo, toggleShowCryo] = useBoolUrlState("cryo", false);
  const [showExtBlocked, toggleShowExtBlocked] = useBoolUrlState(
    "external_block",
    true
  );
  const [showDrafts, toggleShowDrafts] = useBoolUrlState("drafts", false);
  const [showPersonalView , togglePersonalView] = useBoolUrlState("personal", false);
  const hideBelowMedium = ["none", "none", "block"];
  const hideBelowLarge = ["none", "none", "none", "block"];

  useEffect(
    () => setPullFilter("cryo", showCryo ? null : isNotCryogenic),
    [showCryo]
  );
  useEffect(
    () =>
      setPullFilter(
        "external_block",
        showExtBlocked ? null : isNotExternallyBlocked
      ),
    [showExtBlocked]
  );
  useEffect(
    () => setPullFilter("drafts", showDrafts ? null : isNotDraftOrMine),
    [showDrafts]
  );
  useEffect(
    () => setPullFilter("personal", showPersonalView ? isMineViaAffiliation : null),
    [showPersonalView]
  );
  // Set the page title
  const title = getTitle();
  useEffect(() => { document.title = title || ''; }, [title]);

  return (
    <Center
      py={2}
      bgColor="var(--header-background)"
      color="var(--brand-color)"
      {...boxProps}
    >
      <Flex
        px="var(--body-gutter)"
        maxW="100%"
        w="var(--body-max-width)"
        gap="var(--body-gutter)"
        justify="space-between"
      >
        <HStack
          alignSelf="center"
          flexGrow={1}
          flexBasis={sideWidth}
          spacing="2"
        >
          <Button
            display={hideBelowMedium}
            size="sm"
            title="Dark Mode"
            colorScheme="blue"
            variant="ghost"
            onClick={toggleColorMode}
          >
            <FontAwesomeIcon icon={faMoon} />
          </Button>
          <Button
            display={hideBelowMedium}
            size="sm"
            title="Show Recently Merged"
            colorScheme="blue"
            variant={showClosedPulls ? "solid" : "ghost"}
            onClick={toggleShowClosedPulls}
          >
            <FontAwesomeIcon icon={faCodeMerge} />
          </Button>
          <NotificationRequest />
          <Button
            display={hideBelowMedium}
            size="sm"
            title={showPersonalView ? "Show All" : "Show Personal View"}
            colorScheme="blue"
            variant="ghost"
            onClick={togglePersonalView}
          >
            <FontAwesomeIcon icon={showPersonalView ? faUsers : faUser} />
          </Button>
          <Menu closeOnSelect={false}>
            <MenuButton
              as={Button}
              colorScheme="blue"
              size="sm"
              variant="outline"
            >
              Label
            </MenuButton>
            <MenuList>
              <MenuItemOption
                key="Cryo"
                onClick={toggleShowCryo}
                isChecked={showCryo}
              >
                Cryogenic Storage
              </MenuItemOption>
              <MenuItemOption
                key="External"
                onClick={toggleShowExtBlocked}
                isChecked={showExtBlocked}
              >
                External Block
              </MenuItemOption>
              <MenuItemOption
                key="Draft"
                onClick={toggleShowDrafts}
                isChecked={showDrafts}
              >
                Drafts
              </MenuItemOption>
            </MenuList>
          </Menu>
          <Box>
            <FilterMenu
              urlParam="repo"
              buttonText="Repo"
              defaultExculdedValues={reposToHide}
              extractValueFromPull={(pull: Pull) => pull.getRepoName()}
            />
          </Box>
          <Box>
            <FilterMenu
              urlParam="author"
              buttonText="Author"
              extractValueFromPull={(pull: Pull) => pull.user.login}
            />
          </Box>
        </HStack>
        <Flex alignSelf="center" fontSize={20} flexShrink={0}>
          <span style={{ fontVariantCaps: "small-caps" }}>{title}</span>
        </Flex>
        <Box
          flexBasis={sideWidth}
          flexGrow={1}
          flexShrink={1}
          display="flex"
          justifyContent="flex-end"
        >
          <HStack marginRight="12px" >
            <Box display={hideBelowLarge} p="1 15px 0 0" fontSize="16px">
              <ConnectionStateIndicator />
            </Box>
            <Box display={hideBelowLarge} title={`Shown: ${pulls.size} Total: ${allOpenPulls.length}`}>
              <HStack>
                <Text>
                  open:
                </Text>
                <Text w="1.25em" textAlign="center">
                  {pulls.size}
                </Text>
              </HStack>
            </Box>
          </HStack>
          <SearchInput />
        </Box>
      </Flex>
    </Center>
  );
}

function isNotCryogenic(pull: Pull): boolean {
  return !pull.getLabel("Cryogenic Storage");
}

function isNotExternallyBlocked(pull: Pull): boolean {
  return !pull.getLabel("external_block");
}

function isNotDraftOrMine(pull: Pull): boolean {
  return !pull.isDraft() || pull.isMine();
}

function isMineViaAffiliation(pull: Pull): boolean {
  return pull.isMineViaAffiliation();
}

function SearchInput() {
  const setPullFilter = useSetFilter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const updateSearchFilter = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const patterns = event.target.value
        .trim()
        .split(/\s+/)
        .filter((s) => s.length)
        .map((s) => new RegExp(s, "i"));
      setPullFilter(
        "search",
        patterns.length
          ? (pull: Pull) => {
              return patterns.every((pattern) => pull.title.match(pattern) || pull.repo.match(pattern));
            }
          : null
      );
    },
    []
  );

  useHotkeys("/", (event) => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
      event.preventDefault();
    }
  });

  return (
    <Input
      maxWidth={sideWidth}
      w="100%"
      type="search"
      onChange={updateSearchFilter}
      placeholder="Search"
      ref={searchInputRef}
    />
  );
}

function ConnectionStateIndicator() {
  const connectionState = useConnectionState();
  if (connectionState == ConnectionState.connected) {
    return <FontAwesomeIcon icon={faWifi} title="Connected" />;
  }
  if (connectionState == ConnectionState.connecting) {
    return (
      <FontAwesomeIcon
        className="fa-spin"
        icon={faCircleNotch}
        title="Connecting..."
      />
    );
  }
  if (connectionState == ConnectionState.disconnected) {
    return <FontAwesomeIcon icon={faXmark} title="Disconnected" />;
  }
  if (connectionState == ConnectionState.error) {
    return <FontAwesomeIcon icon={faCircleExclamation} title="Error" />;
  }
  return null;
}
