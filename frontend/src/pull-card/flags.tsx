import { Pull } from '../pull';
import { Link } from "@chakra-ui/react"
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarning, faMinusCircle } from '@fortawesome/free-solid-svg-icons'

export function Flags({pull}: {pull: Pull}) {
   const devBlock = pull.getDevBlock();
   const deployBlock = pull.getDeployBlock();
   return (<>
      {deployBlock && <PullFlag
         href={pull.linkToSignature(deployBlock)}
         cssVarPrefix="--tag-deploy-blocked"
         icon={faWarning}
      />}
      {devBlock && <PullFlag
         href={pull.linkToSignature(devBlock)}
         cssVarPrefix="--tag-dev-blocked"
         icon={faMinusCircle}
      />}
   </>);
}

interface PullFlagProps {
   href: string,
   icon: IconDefinition;
   cssVarPrefix: string;
}

function PullFlag({href, icon, cssVarPrefix}: PullFlagProps) {
   return (<Link
      href={href}
      color={`var(${cssVarPrefix})`}
      py="5px"
      px="6px"
      lineHeight="1em"
      className="pull-flag"
      backgroundColor={`var(${cssVarPrefix}-background)`}
      border={`var(${cssVarPrefix}-border) solid 1px`}
      borderRadius="3px"><FontAwesomeIcon
         fontSize="18px"
         icon={icon}/>
   </Link>);
}
