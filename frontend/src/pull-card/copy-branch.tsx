import { memo } from "react"
import { useClipboard, chakra } from "@chakra-ui/react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faCheck } from '@fortawesome/free-solid-svg-icons'

const CopyBranchIcon = chakra(FontAwesomeIcon, {
   baseStyle: {
      marginLeft: "10px",
      cursor: "pointer",
      color: "var(--copy-branch)",
      "&:hover": {
         color: "var(--copy-branch-hover)",
      },
   }
});

export const CopyBranch = memo(
function CopyBranch({className, value}: {className:string, value:string}) {
   const {onCopy, hasCopied} = useClipboard(value);
   return (
      <CopyBranchIcon
         title="Copy branch name"
         size="lg"
         className={className}
         onClick={onCopy}
         icon={hasCopied ? faCheck : faCopy}
      />
   );
});
