import { getUser } from '../page-context';
import { Pull } from '../pull';
import { Signature, SignatureGroup } from '../types';
import { Box, HStack, useStyleConfig } from "@chakra-ui/react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons'

interface SignaturesProps {
   pull: Pull,
   title: string,
   signatures: SignatureGroup,
   required: number,
}

export function Signatures({pull, title, signatures, required}: SignaturesProps) {
   const statusVariant = signatures.current.length >= required ?
      (pull.isMine() ? 'validMine' : 'valid') : undefined;
   const styles = useStyleConfig('Signatures', {variant: statusVariant});
   const allSignatures = [...signatures.current, ...signatures.old];
   const unfulfilledCount = Math.max(0, required - signatures.current.length);

   return (
      <HStack
         py="5px"
         pr={2}
         pl={2}
         lineHeight="1em"
         spacing={1}
         sx={styles}
      >
      <Box mr={2}>{title}</Box>
      {NewAndOldSigs(allSignatures)}
      {UnfullfilledSigs(unfulfilledCount)}
   </HStack>
   );
}

function NewAndOldSigs(allSignatures: Signature[]) {
   return allSignatures.map((sig) => {
      return (<FontAwesomeIcon
         fontSize="18px"
         color={colorForSignature(sig)}
         key={sig.data.comment_id}
         title={sig.data.user.login}
         className="build_status"
         icon={faCheckCircle}/>)
   });
}

function UnfullfilledSigs(count: number) {
   const sigs = new Array(count);
   for (let i = 0; i < count; i++) {
      sigs[i] = (<FontAwesomeIcon
         fontSize="18px"
         color="var(--signature-default)"
         key={"empty" + i}
         className="build_status"
         icon={faCheckCircle}/>);
   }
   return sigs;
}

function colorForSignature(sig: Signature): string {
   if (sig.data.active) {
      return getUser() === sig.data.user.login ?
         "var(--signature-valid-mine)" : "var(--signature-valid)";
   } else {
      return getUser() === sig.data.user.login ?
         "var(--signature-invalid-mine)" : "var(--signature-invalid)";
   }
}
