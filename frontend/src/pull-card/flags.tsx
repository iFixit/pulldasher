import { Pull } from '../pull';
import { Link } from "@chakra-ui/react"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarning } from '@fortawesome/free-solid-svg-icons'

export function Flags({pull}: {pull: Pull}) {
   return (<>
      {pull.hasDeployBlock() && <Link
         href={pull.linkToSignature(pull.status.deploy_block[0])}
         color="var(--tag-deploy-blocked)"
         py="5px"
         px="6px"
         lineHeight="1em"
         className="pull-flag"
         backgroundColor="var(--tag-deploy-blocked-background)"
         border="var(--tag-deploy-blocked-border) solid 1px"
         borderRadius="3px"><FontAwesomeIcon
            fontSize="18px"
            icon={faWarning}/>
      </Link>}
   </>);
}
