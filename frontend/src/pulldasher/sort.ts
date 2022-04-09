import { Pull } from '../pull';
import { getUser } from "../page-context";

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
      compareBool(!a.getLabel('external_block'), !b.getLabel('external_block')) ||
      // Pulls with no QAing label above those with QAing
      compareBool(!a.getLabel('QAing'), !b.getLabel('QAing')) ||
      // Pulls with CR completed above those that need more
      compareBool(a.isCrDone(), b.isCrDone()) ||
      // Older pulls before younger pulls
      a.created_at.localeCompare(b.created_at)
   );
}

function isQAingByMe(pull: Pull): boolean {
   const label = pull.getLabel('QAing');
   return !!(label && label.user == getUser());
}

function compareBool(a: boolean, b: boolean): number {
   return +b - +a;
}
