import { PullData, SignatureType } from '../src/types';
import { sig, daysAgo, pullData } from "./pull-data-parts";

export const AgePulls = <PullData[]> [
   pullData({
      title: "Brand new pull",
   }),
   pullData({
      title: "4 day old pull",
      created_at: daysAgo(4),
   }),
   pullData({
      title: "20 day old pull",
      created_at: daysAgo(20),
   }),
];

export const UnfulfilledRequirements = <PullData[]> [
   pullData({
      title: "No Requirements",
      cr_req: 0,
      qa_req: 0,
   }),
   pullData({
      title: "3 CR Required but no QA",
      cr_req: 3,
      qa_req: 0,
   }),
   pullData({
      title: "3 CR Required and 2 QA",
      cr_req: 3,
      qa_req: 2,
   }),
];

const activeCR = sig(SignatureType.CR, true);
const activeQA = sig(SignatureType.QA, true);
export const PartialRequirements = <PullData[]> [
   pullData({
      title: "1 CR and 1 QA",
      status: {
         allQA: [activeQA],
         allCR: [activeCR],
      },
   }),
   pullData({
      title: "1 CR and 1 QA, but higher requirements",
      cr_req: 3,
      qa_req: 2,
      status: {
         allQA: [activeQA],
         allCR: [activeCR],
      },
   }),
   pullData({
      title: "1 CR and 1 QA, but no requirements",
      cr_req: 0,
      qa_req: 0,
   }),
];
