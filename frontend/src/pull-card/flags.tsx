import { Pull } from '../pull';
import { actionMessage } from '../utils';
import { Link, Box, useStyleConfig } from "@chakra-ui/react"
import { memo } from "react"
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarning, faMinusCircle, faEye, faEyeSlash, faSnowflake } from '@fortawesome/free-solid-svg-icons'

export const Flags = memo(
function Flags({pull}: {pull: Pull}) {
   const devBlock = pull.getDevBlock();
   const readyButNoCI = pull.isReady() && !pull.isCiRequired();
   const deployBlock = pull.getDeployBlock();
   const QAing = pull.getLabel("QAing");
   const externalBlock = pull.getLabel("external_block");
   const cryogenicStorage = pull.getLabel("Cryogenic Storage");
   return (<>
      {deployBlock && <PullFlag
         variant="deployBlock"
         title={actionMessage('Deploy blocked', deployBlock.data.created_at, deployBlock.data.user.login)}
         href={pull.linkToSignature(deployBlock)}
         icon={faWarning}
      />}
      {readyButNoCI && <PullFlag
         variant="deployBlock"
         title={"No CI, deploy carefully"}
         icon={faWarning}
      />}
      {devBlock && <PullFlag
         variant="devBlock"
         title={actionMessage('Dev blocked', devBlock.data.created_at, devBlock.data.user.login)}
         href={pull.linkToSignature(devBlock)}
         icon={faMinusCircle}
      />}
      {QAing && <PullFlag
         variant="QAing"
         title={actionMessage('QA started', QAing.created_at, QAing.user)}
         icon={faEye}
      />}
      {externalBlock && <PullFlag
         variant="externalBlock"
         title={actionMessage('Externally blocked', externalBlock.created_at, externalBlock.user)}
         icon={faEyeSlash}
      />}
      {cryogenicStorage && <PullFlag
         variant="cryogenicStorage"
         title={actionMessage('Put on ice', cryogenicStorage.created_at, cryogenicStorage.user)}
         icon={faSnowflake}
      />}
   </>);
});

interface PullFlagProps {
   href?: string,
   variant: string,
   title?: string,
   icon: IconDefinition;
}

function PullFlag({variant, title, href, icon}: PullFlagProps) {
   const styles = useStyleConfig('PullFlag', {variant: variant});
   return (href ?
   <Link
      sx={styles}
      href={href}
      title={title}
      className="pull-flag">
      <FontAwesomeIcon icon={icon}/>
   </Link> :
   <Box
      sx={styles}
      title={title}
      className="pull-flag">
      <FontAwesomeIcon icon={icon}/>
   </Box>);
}
