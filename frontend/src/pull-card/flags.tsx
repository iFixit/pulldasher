import { Pull } from '../pull';
import { Link, useStyleConfig } from "@chakra-ui/react"
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarning, faMinusCircle } from '@fortawesome/free-solid-svg-icons'

export function Flags({pull}: {pull: Pull}) {
   const devBlock = pull.getDevBlock();
   const deployBlock = pull.getDeployBlock();
   return (<>
      {deployBlock && <PullFlag
         variant="deployBlock"
         href={pull.linkToSignature(deployBlock)}
         icon={faWarning}
      />}
      {devBlock && <PullFlag
         variant="devBlock"
         href={pull.linkToSignature(devBlock)}
         icon={faMinusCircle}
      />}
   </>);
}

interface PullFlagProps {
   href: string,
   variant: string,
   icon: IconDefinition;
}

function PullFlag({variant, href, icon}: PullFlagProps) {
   const styles = useStyleConfig('PullFlag', {variant: variant});
   return (<Link
      sx={styles}
      href={href}
      className="pull-flag">
      <FontAwesomeIcon icon={icon}/>
   </Link>);
}
