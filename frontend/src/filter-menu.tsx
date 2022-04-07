import { useAllPulls, useSetFilter } from './pulldasher/pulls-context';
import { useArrayUrlState } from './use-url-state';
import { Pull } from './pull';
import { useConst, Button, Menu, MenuButton, MenuList, MenuDivider, MenuOptionGroup, MenuItemOption } from "@chakra-ui/react";
import { useEffect, useCallback, useMemo } from 'react'

type RepoCounts = Map<string, number>;
type ValueGetter = (pull: Pull) => string;

type FilterMenuProps = {
   urlParam: string,
   buttonText: string,
   extractValueFromPull: ValueGetter,
};

export function FilterMenu({urlParam, buttonText, extractValueFromPull}: FilterMenuProps) {
   const pulls = useAllPulls();
   // Default is empty array that implies show all pulls (no filtering)
   const [selectedRepos, setSelectedRepos] = useArrayUrlState(urlParam, []);
   // Nothing selected == show everything, otherwise, it'd be empty
   const showAll = selectedRepos.length === 0;
   // List from url may contain repos we have no pulls for
   const urlRepos = useConst(() => new Set(selectedRepos));
   const setPullFilter = useSetFilter();

   // May include repos frmo the url for which there are no pulls
   const allRepos = useMemo(() => {
      // All repos of open pulls
      const pullRepos = new Set(pulls.map(extractValueFromPull));
      return [...new Set([...pullRepos, ...urlRepos])]
   }, [pulls]);
   const repoToPullCount = useMemo(() => getRepoToPullCount(pulls, extractValueFromPull), [pulls]);

   const onSelectedChange = useCallback((newSelectedRepos: string | string[]) => {
      // Make typescript happy cause it thinks newSelectedRepos can be a single
      // string
      newSelectedRepos = Array.from(newSelectedRepos);

      // Update the url
      setSelectedRepos(newSelectedRepos);

      // Update the pull filter
      const selectedReposSet = new Set(newSelectedRepos);
      setPullFilter('repo', selectedReposSet.size === 0 ? null : (pull) =>
         selectedReposSet.has(extractValueFromPull(pull))
      );
   }, [setPullFilter, setSelectedRepos]);

   // Load initial state from url just once
   useEffect(() => onSelectedChange(selectedRepos), []);

   return (
   <Menu closeOnSelect={false}>
     <MenuButton as={Button} colorScheme='blue' size="sm" variant="outline">
       {buttonText}
     </MenuButton>
     <MenuList minWidth='240px'>
        <MenuOptionGroup
           type='checkbox'
           value={showAll ? allRepos : selectedRepos}
           onChange={onSelectedChange}>
          {allRepos.map((repo) =>
             <MenuItemOption
                key={repo}
                value={repo}>
                {repo} ({repoToPullCount.get(repo) || 0})
             </MenuItemOption>
          )}
       </MenuOptionGroup>
       <MenuDivider/>
       <MenuItemOption
          key="Show All"
          onClick={() => onSelectedChange([])}
          isChecked={showAll}>
          Show All
       </MenuItemOption>
     </MenuList>
   </Menu>
   );
}

function getRepoToPullCount(pulls: Pull[], extractValueFromPull: ValueGetter): RepoCounts {
   return pulls.reduce((counts, pull) => {
      const pullKey = extractValueFromPull(pull);
      counts.set(pullKey, (counts.get(pullKey) || 0) + 1);
      return counts;
   }, new Map() as RepoCounts);
}
