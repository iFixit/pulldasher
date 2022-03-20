import { getUser } from '../src/page-context';
import { PullData, SignatureType } from '../src/types';
import { label, status, sig, daysAgo, pullData } from "./pull-data-parts";

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
      status: {
         allQA: [activeQA],
         allCR: [activeCR],
      },
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
      title: "2 active and 1 out of date CR where only 2 are required. QA has 2 active, 1 out of date and 1 required",
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
            status("failure"),
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
            status("failure"),
            status("success"),
            status("failure"),
            status("success"),
            status("success"),
         ]
      },
   }),
];

const devBlock = sig(SignatureType.dev_block, true);
const deployBlock = sig(SignatureType.deploy_block, true);
export const Blocked = <PullData[]> [
   pullData({
      title: "Deploy Blocked",
      status: {
         deploy_block: [deployBlock],
      },
   }),
   pullData({
      title: "Dev Blocked",
      status: {
         dev_block: [devBlock],
      },
   }),
];

export const Milestones = <PullData[]> [
   pullData({
      title: "With a future Milestone",
      milestone: {
         title: "Some big project",
         due_on: daysAgo(-10),
      }
   }),
   pullData({
      title: "With a past Milestone",
      milestone: {
         title: "Some overdue project",
         due_on: daysAgo(10),
      }
   }),
];

export const Labels = <PullData[]> [
   pullData({
      title: "With a QAing Label applied 1 hour ago",
      labels: [label({
         "title": "QAing",
         "user": "someUser",
         "created_at": daysAgo(1/24),
      })],
   }),
   pullData({
      title: "With an external_block Label applied 1 day ago",
      labels: [label({
         "title": "external_block",
         "user": "someOtherUser",
         "created_at": daysAgo(1),
      })],
   }),
];

export const MyOwn = <PullData[]> [
   pullData({
      title: "Pull Created By Me",
      user: {
         login: getUser(),
      }
   }),
   pullData({
      title: "With an up-to-date CR and a QA by Me",
      status: {
         allQA: [sig(SignatureType.QA, true, getUser())],
         allCR: [sig(SignatureType.CR, true, getUser())],
      },
   }),
   pullData({
      title: "With an out-of-date CR and a QA by Me",
      status: {
         allQA: [sig(SignatureType.QA, false, getUser())],
         allCR: [sig(SignatureType.CR, false, getUser())],
      },
   }),
];

export const KitchenSink = <PullData[]> [
   pullData({
      title: "Pull With Lots of flags and such and a really long title",
      user: {
         login: getUser(),
      },
      cr_req: 3,
      qa_req: 2,
      status: {
         deploy_block: [deployBlock],
         dev_block: [devBlock],
         commit_statuses: [
            status("success"),
            status("error"),
            status("success"),
            status("pending"),
            status("success"),
            status("failure"),
            status("success"),
            status("failure"),
            status("success"),
            status("success"),
         ]
      },
      labels: [label({
         "title": "QAing",
         "user": "someUser",
         "created_at": daysAgo(1/24),
      })],
   }),
];