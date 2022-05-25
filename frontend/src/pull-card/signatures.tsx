import { getUser } from '../page-context';
import { Pull } from '../pull';
import { Avatar } from './avatar';
import { formatDate } from '../utils';
import { Signature, SignatureGroup } from '../types';
import {
   chakra,
   Box,
   HStack,
   useStyleConfig,
   Popover,
   PopoverTrigger,
   PopoverContent,
   PopoverBody,
   PopoverArrow,
   PopoverCloseButton,
   Portal,
} from "@chakra-ui/react"
import { memo } from "react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons'

interface SignaturesProps {
   pull: Pull,
   title: string,
   signatures: SignatureGroup,
   required: number,
}

const SigSectionTitle = Box;

function SignaturesFlag({pull, title, signatures, required}: SignaturesProps) {
   const statusVariant = signatures.current.length >= required ?
      (pull.isMine() ? 'validMine' : 'valid') : undefined;
   const styles = useStyleConfig('Signatures', {variant: statusVariant});
   const allSignatures = [...signatures.current, ...signatures.old];
   const requiredSignatures = required ? allSignatures.slice(0, required) : allSignatures;
   const unfulfilledCount = Math.max(0, required - allSignatures.length);
   const noneToShow = required == 0 && allSignatures.length == 0;

   return (
      <HStack
         py="5px"
         pr={2}
         pl={2}
         lineHeight="1em"
         spacing={1}
         sx={styles}
         title={noneToShow ? `No ${title} Required` : ''}
      >
         <Box m="2px" mr={noneToShow ? "2px" : 2}>{title}</Box>
         {requiredSignatures.map((sig) =>
            <SignatureBubble key={sig.data.created_at} sig={sig}/>)}
         {UnfullfilledSigs(unfulfilledCount)}
      </HStack>
   );
}

export const Signatures = memo(
function Signatures(props: SignaturesProps) {
   const {pull, signatures} = props;
   const noSignatures = (signatures.current.length === 0) && (signatures.old.length === 0);

   if (noSignatures) {
      return <SignaturesFlag {...props}/>;
   }

   return (
   <Popover>
      <PopoverTrigger>
         <Box>
            <SignaturesFlag {...props}/>
         </Box>
      </PopoverTrigger>
      <Portal>
         <PopoverContent>
            <PopoverArrow />
            <PopoverCloseButton />
            <PopoverBody>
               {signatures.current.length > 0 && (
                  <>
                     <SigSectionTitle color="var(--signature-valid)">
                        Signed Off
                     </SigSectionTitle>
                     <SignatureList sigs={signatures.current} pull={pull}/>
                  </>
               )}
               {signatures.old.length > 0 && (
                  <>
                     <SigSectionTitle color="var(--signature-invalid)">
                        Previously Signed Off
                     </SigSectionTitle>
                     <SignatureList sigs={signatures.old} pull={pull}/>
                  </>
               )}
            </PopoverBody>
         </PopoverContent>
      </Portal>
   </Popover>
   );
});

function SignatureBubble({sig}: {sig: Signature}) {
   return (<a
      key={sig.data.comment_id}>
      <FontAwesomeIcon
         fontSize="18px"
         color={colorForSignature(sig)}
         title={sig.data.user.login}
         className="build_status"
         icon={faCheckCircle}/>
   </a>);
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

function SignatureList({sigs, pull}: {sigs: Signature[], pull: Pull}) {
   return <Box>{sigs.map(sig =>
      <SignatureListItem key={String(sig.data.created_at)} sig={sig} pull={pull}/>
   )}</Box>;
}

function SignatureListItem({sig, pull}: {sig: Signature, pull: Pull}) {
   const styles = useStyleConfig('SignatureListItem');
   return (<chakra.a
      __css={styles}
      target="_blank"
      href={pull.linkToSignature(sig)}>
      <Avatar user={sig.data.user.login}/>
      {formatDate(sig.data.created_at)} by {sig.data.user.login}
   </chakra.a>);
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