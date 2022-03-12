import { PullData } from '../src/types';
import { head, daysAgo, pullData } from "./pull-data-parts";

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

export const Requirements = <PullData[]> [
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
