import { Pull } from "./pull";
import { PullCard } from "./pull-card";
import { useBoolUrlState } from "./use-url-state";
import { useFilteredOpenPulls } from "./pulldasher/pulls-context";
import { Box, Flex, Spacer, useStyleConfig } from "@chakra-ui/react";

interface ColumnProps {
  variant?: string;
  pulls: Pull[];
  title: string;
  id: string;
  showLinesChanged: boolean;
}

export function Column(props: ColumnProps) {
  const pullsToShow = useFilteredOpenPulls();
  const [open, toggleOpen] = useBoolUrlState(props.id, true);
  const styles = useStyleConfig("Column", { variant: props.variant });
  return (
    <Box __css={styles} overflow="hidden">
      <Flex className="column_header" onClick={toggleOpen}>
        <Box p={3} pl={4}>
          {props.title}
        </Box>
        <Spacer />
        <Box className="pull_count" p={3}>
          {countPulls(props.pulls, pullsToShow)}
        </Box>
      </Flex>
      <Box display={open ? "block" : "none"}>
        {props.pulls.map((pull) => (
          <PullCard
            key={pull.getKey()}
            pull={pull}
            show={pullsToShow.has(pull)}
          />
        ))}
      </Box>
    </Box>
  );
}

function countPulls(pulls: Pull[], pullsToShow: Set<Pull>): number {
  return pulls.reduce(
    (count, pull) => count + (pullsToShow.has(pull) ? 1 : 0),
    0
  );
}
