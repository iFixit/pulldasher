import { Pull } from "../src/pull";
import { PullData } from "../src/types";
import { ChakraProvider, Box, HStack, Heading } from "@chakra-ui/react";
import {
  AgePulls,
  UnfulfilledRequirements,
  PartialRequirements,
  FulfilledRequirements,
  Signatures,
  ManySignatures,
  FewStatuses,
  RequiredStatuses,
  ManyStatuses,
  Blocked,
  Milestones,
  Labels,
  MyOwn,
  KitchenSink,
} from "./named-pulls";
import { PullCard } from "../src/pull-card";
import { render } from "react-dom";
import { theme } from "../src/theme";

const root = document.createElement("div");
document.body.appendChild(root);

function PullCardDemo() {
  return (
    <ChakraProvider theme={theme}>
      <Row title="Different Ages" pullDatas={AgePulls} />
      <Row
        title="Unfulfilled Requirements"
        pullDatas={UnfulfilledRequirements}
      />
      <Row title="Partial Requirements" pullDatas={PartialRequirements} />
      <Row title="Fulfilled Requirements" pullDatas={FulfilledRequirements} />
      <Row title="Signatures in Different states" pullDatas={Signatures} />
      <Row title="Many Signatures" pullDatas={ManySignatures} />
      <Row title="Few Commit Statuses" pullDatas={FewStatuses} />
      <Row
        title="Repo with Required Commit Status 'unit-tests'"
        pullDatas={RequiredStatuses}
      />
      <Row title="Many Commit Statuses" pullDatas={ManyStatuses} />
      <Row title="Blocked" pullDatas={Blocked} />
      <Row title="Milestones" pullDatas={Milestones} />
      <Row title="Labels" pullDatas={Labels} />
      <Row title="My Own" pullDatas={MyOwn} />
      <Row title="Kitchen Sink (all the things)" pullDatas={KitchenSink} />
    </ChakraProvider>
  );
}

function Row({ title, pullDatas }: { title: string; pullDatas: PullData[] }) {
  return (
    <>
      <Box m={10} maxW={1024}>
        <Heading size="lg">{title}</Heading>
        <HStack spacing={5}>
          {pullDatas.map((pullData, i) => (
            <Box
              key={i}
              w="30%"
              border="1px solid var(--panel-default-border)"
              overflow="hidden"
            >
              <PullCard pull={new Pull(pullData)} show={true} />
            </Box>
          ))}
        </HStack>
      </Box>
    </>
  );
}

render(<PullCardDemo />, root);
