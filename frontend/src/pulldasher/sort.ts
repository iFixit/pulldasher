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

function compareBool(a: boolean, b: boolean): number {
   return +b - +a;
}
