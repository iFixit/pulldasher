import { DateString } from "../types";
import { Box } from "@chakra-ui/react";

export function Age({ created_at }: { created_at: DateString }) {
  const createdAt = new Date(created_at);
  const timeDifference = Date.now() - createdAt.getTime();
  const daysSinceCreation = Math.ceil(timeDifference / (1000 * 3600 * 24));
  const numDots = Math.min(daysSinceCreation, 30);
  const dot = "•";
  const tooltip = `opened at ${createdAt.toLocaleString()}`;

  return (
    <Box title={tooltip} color={`var(${getAgeColor(daysSinceCreation)})`}>
      {dot.repeat(numDots)}
    </Box>
  );
}

function getAgeColor(days: number): string {
  switch (Math.ceil(days / 4)) {
    case 1:
      return "--age-1";
    case 2:
      return "--age-2";
    default:
      return "--age-3";
  }
}
