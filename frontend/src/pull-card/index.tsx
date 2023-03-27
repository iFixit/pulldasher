import { Pull } from "../pull";
import { CommitStatuses } from "./commit-statuses";
import { Age } from "./age";
import { Flags } from "./flags";
import { Avatar } from "./avatar";
import { Signatures } from "./signatures";
import { CopyBranch } from "./copy-branch";
import { memo, useEffect, useRef, RefObject } from "react";
import { RefreshButton } from "./refresh";
import { Flex, Box, Link, chakra, Text } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faStar,
  faCodeMerge,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

const Card = chakra(Flex, {
  baseStyle: {
    position: "relative",
    p: 4,
    pl: 6,
    borderTop: "1px var(--pull-separator) solid",
    "&:hover .build_status": {
      opacity: 1,
    },
    "& .copy": {
      visibility: "hidden",
    },
    "&:hover .copy": {
      visibility: "visible",
    },
    "&:hover .refresh": {
      visibility: "visible",
    },
    "& .star": {
      marginRight: "0.5em",
    },
    "&.highlight": {
      animation: "highlightPull 2s",
    },
  },
});

const SigsAndFlags = chakra(Flex, {
  baseStyle: {
    mt: 3,
    "& > *": {
      marginRight: "5px",
      marginBottom: "5px",
    },
  },
});

export const PullCard = memo(function PullCard({
  pull,
  show,
  showLinesChanged,
}: {
  pull: Pull;
  show: boolean;
  showLinesChanged?: boolean;
}) {
  const cardRef = useRef<HTMLElement>(null);
  highlightOnChange(cardRef, [pull.received_at]);

  return (
    <Card ref={cardRef} display={show ? undefined : "none"}>
      <RefreshButton pull={pull} />
      <CommitStatuses pull={pull} />
      <Box>
        <Link
          href={pull.getUrl()}
          title={pull.user.login}
          isExternal
          color="var(--pull-title)"
        >
          {pull.isMine() ? (
            <FontAwesomeIcon
              icon={faStar}
              className="star"
              color="var(--user-icon)"
            />
          ) : (
            <Avatar user={pull.user.login} linkToProfile />
          )}
          <chakra.span fontWeight="bold">
            {pull.getRepoName()} #{pull.number}:{" "}
          </chakra.span>
          {pull.title}
        </Link>
        {showLinesChanged &&
          <>
          <Text
            as="span"
            ml="6px"
            title={pull.additions == 1 ? `${pull.additions} addition` : `${pull.additions} additions`}
            fontSize="13px"
            color="var(--additions)">
            +{pull.additions}
          </Text>
          <Text
            as="span"
            ml="6px"
            title={pull.deletions == 1 ? `${pull.deletions} deletion` : `${pull.deletions} deletions`}
            fontSize="13px"
            color="var(--deletions)">
            -{pull.deletions}
          </Text>
          </>
        }
        <CopyBranch value={pull.head.ref} className="copy" />
        <SigsAndFlags wrap="wrap">
          <Signatures
            pull={pull}
            signatures={pull.cr_signatures}
            required={pull.status.cr_req}
            title="CR"
          />
          <Signatures
            pull={pull}
            signatures={pull.qa_signatures}
            required={pull.status.qa_req}
            title="QA"
          />
          <Flags pull={pull} />
        </SigsAndFlags>
        <Age created_at={pull.created_at} />
      </Box>
    </Card>
  );
});

export const ClosedPullCard = memo(function ClosedPullCard({
  pull,
  show,
}: {
  pull: Pull;
  show: boolean;
}) {
  const wasMerged = !!pull.merged_at;
  return (
    <Card display={show ? undefined : "none"}>
      <RefreshButton pull={pull} />
      <Box>
        <Box mt={-2} ml={-2} mb={2}>
          <chakra.span pr={2}>
            {wasMerged ? (
              <FontAwesomeIcon
                icon={faCodeMerge}
                size="lg"
                color="var(--pull-merged)"
              />
            ) : (
              <FontAwesomeIcon icon={faXmark} color="var(--pull-closed)" />
            )}
          </chakra.span>
          <chakra.span color="var(--pull-title)">
            {formatDate(pull.closed_at)}
          </chakra.span>
        </Box>
        <Link
          href={pull.getUrl()}
          title={pull.user.login}
          isExternal
          textDecoration={wasMerged ? "none" : "line-through"}
          color="var(--pull-title)"
        >
          {pull.isMine() ? (
            <FontAwesomeIcon
              icon={faStar}
              className="star"
              color="var(--user-icon)"
            />
          ) : (
            <Avatar user={pull.user.login} linkToProfile />
          )}
          <chakra.span fontWeight="bold">
            {pull.getRepoName()} #{pull.number}:{" "}
          </chakra.span>
          {pull.title}
        </Link>
      </Box>
    </Card>
  );
});

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "short",
});

const formatDate = (dateStr: string | null) => {
  return dateStr ? formatter.format(new Date(dateStr)) : null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function highlightOnChange(
  ref: RefObject<HTMLElement>,
  dependencies: Array<any>
) {
  // Animate a highlight when pull.received_at changes
  useEffect(() => {
    ref.current?.classList.add("highlight");
    // 1s after the animation, remove the class
    setTimeout(() => ref.current?.classList.remove("highlight"), 3000);
  }, dependencies);
}
