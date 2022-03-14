import { Pull } from '../pull';
import { actionMessage } from '../utils';
import { Link, Box, useStyleConfig } from "@chakra-ui/react"
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarning, faMinusCircle, faEye } from '@fortawesome/free-solid-svg-icons'

export function Flags({pull}: {pull: Pull}) {
   const devBlock = pull.getDevBlock();
   const deployBlock = pull.getDeployBlock();
   const QAing = pull.getLabel("QAing");
   return (<>
      {deployBlock && <PullFlag
         variant="deployBlock"
         title={actionMessage('Deploy blocked', deployBlock.data.created_at, deployBlock.data.user.login)}
         href={pull.linkToSignature(deployBlock)}
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
   </>);
}

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
