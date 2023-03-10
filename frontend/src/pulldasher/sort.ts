import { Pull } from "../pull";
import { getUser } from "../page-context";
import { Signature } from "../types";

export function defaultCompare(a: Pull, b: Pull): number {
  return (
    // My pulls above pulls that aren't mine
    compareBool(a.isMine(), b.isMine()) ||
    // Pulls I have to CR/QA above those I don't
    compareBool(a.hasOutdatedSig(getUser()), b.hasOutdatedSig(getUser())) ||
    // Pulls I haven't touched vs those I have already CRed
    compareBool(!a.hasCurrentSig(getUser()), !b.hasCurrentSig(getUser()))
  );
}

export function QACompare(a: Pull, b: Pull): number {
  return (
    // Pulls I'm QAing above those I'm not
    compareBool(isQAingByMe(a), isQAingByMe(b)) ||
    // Pulls with no external_block above those with external_block
    compareBool(!a.getLabel("external_block"), !b.getLabel("external_block")) ||
    // Pulls with no merge conflicts above those with merge conflicts
    compareBool(!a.hasMergeConflicts(), !b.hasMergeConflicts()) ||
    // Pulls with no QAing label above those with QAing
    compareBool(!a.getLabel("QAing"), !b.getLabel("QAing")) ||
    // Pulls with CR completed above those that need more
    compareBool(a.isCrDone(), b.isCrDone()) ||
    // Older pulls before younger pulls
    a.created_at.localeCompare(b.created_at)
  );
}

export function DeployCompare(a: Pull, b: Pull): number {
  return (
    // Pulls with no merge conflicts above those with merge conflicts
    compareBool(!a.hasMergeConflicts(), !b.hasMergeConflicts())
  );
}

export function signatureCompare(a: Signature, b: Signature) {
  return (
    // Active before inactive
    b.data.active - a.data.active ||
    // My sigs before others
    compareBool(
      a.data.user.login == getUser(),
      b.data.user.login == getUser()
    ) ||
    // Older before newer
    a.data.created_at.localeCompare(b.data.created_at)
  );
}

export function closedAtCompare(a: Pull, b: Pull) {
  const astr = String(a.closed_at);
  const bstr = String(b.closed_at);
  return astr < bstr ? 1 : astr > bstr ? -1 : 0;
}

function isQAingByMe(pull: Pull): boolean {
  const label = pull.getLabel("QAing");
  return label?.user == getUser();
}

function compareBool(a: boolean, b: boolean): number {
  return +b - +a;
}
