import { PullData, SignatureType } from '../src/types';
import { status, sig, daysAgo, pullData } from "./pull-data-parts";

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

const activeCR2 = sig(SignatureType.CR, true);
const activeQA2 = sig(SignatureType.QA, true);
export const FulfilledRequirements = <PullData[]> [
   pullData({
      title: "1 CR and 1 QA",
      status: {
         allQA: [activeQA],
         allCR: [activeCR],
      },
   }),
   pullData({
      title: "2 CR and 2 QA but 2,1 is required",
      cr_req: 2,
      qa_req: 1,
      status: {
         allQA: [activeQA, activeQA2],
         allCR: [activeCR, activeCR2],
      },
   }),
   pullData({
      title: "2 active and 1 out of date CR where only 2 are required. Same with QA",
      cr_req: 2,
      qa_req: 1,
      status: {
         allQA: [activeQA, activeQA2, sig(SignatureType.QA, false)],
         allCR: [activeCR, activeCR2, sig(SignatureType.CR, false)],
      },
   }),
];

export const FewStatuses = <PullData[]> [
   pullData({
      title: "Pending status with no log url",
      status: {
         commit_statuses: [status("pending", null)]
      },
   }),
   pullData({
      title: "One error commit status",
      status: {
         commit_statuses: [status("error")]
      },
   }),
   pullData({
      title: "One successful and one failed commit status",
      status: {
         commit_statuses: [status("success"), status("failure")]
      },
   }),
];

export const ManyStatuses = <PullData[]> [
   pullData({
      title: "Three commit statuses",
      status: {
         commit_statuses: [
            status("pending"),
            status("success"),
            status("error"),
         ]
      },
   }),
   pullData({
      title: "Six commit statuses",
      status: {
         commit_statuses: [
            status("error"),
            status("pending"),
            status("success"),
            status("pending"),
            status("success"),
            status("error"),
         ]
      },
   }),
   pullData({
      title: "Ten commit statuses",
      status: {
         commit_statuses: [
            status("success"),
            status("error"),
            status("success"),
            status("pending"),
            status("success"),
            status("pending"),
            status("success"),
            status("success"),
            status("success"),
            status("success"),
         ]
      },
   }),
];
