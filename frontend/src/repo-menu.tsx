import { useAllPulls, useSetFilter } from './pulldasher/pulls-context';
import { useArrayUrlState } from './use-url-state';
import { Button, Menu, MenuButton, MenuList, MenuOptionGroup, MenuItemOption } from "@chakra-ui/react";
import { useEffect, useCallback, useMemo } from 'react'

export function RepoMenu() {
   const pulls = useAllPulls();
   const [selectedRepos, setSelectedRepos] = useArrayUrlState('repo', []);
   // Nothing selected == show everything, otherwise, it'd be empty
   const showAll = selectedRepos.length === 0;
   const setPullFilter = useSetFilter();

   const allRepos = useMemo(() => Array.from(new Set(pulls.map((pull) => pull.getRepoName()))), [pulls]);
   const selectedReposSet = useMemo(() => new Set(selectedRepos), [selectedRepos]);

   const onSelectedChange = useCallback((newSelectedRepos: string | string[]) => {
      newSelectedRepos = Array.from(newSelectedRepos);
      // If they've selected *all* the repos, then let's reset it to the
      // default (empty array == show all repos)
      if (newSelectedRepos.length == allRepos.length) {
         newSelectedRepos = [];
      }

      // Update the url
      setSelectedRepos(newSelectedRepos);

      // Update the pull filter
      const selectedReposSet = new Set(newSelectedRepos);
      setPullFilter('repo', selectedReposSet.size === 0 ? null : (pull) =>
         selectedReposSet.has(pull.getRepoName())
      );
   }, [setPullFilter, setSelectedRepos, allRepos]);

   // Load initial state from url just once
   useEffect(() => onSelectedChange(selectedRepos), []);

   return (
   <Menu closeOnSelect={false}>
     <MenuButton as={Button} colorScheme='blue' size="sm" variant="outline">
       Repo
     </MenuButton>
     <MenuList minWidth='240px'>
        <MenuOptionGroup
           type='checkbox'
           value={showAll ? allRepos : selectedRepos}
           onChange={onSelectedChange}>
          {allRepos.map((repo) =>
             <MenuItemOption
                key={repo}
                value={repo}
                isChecked={showAll || selectedReposSet.has(repo)}>
                {repo}
             </MenuItemOption>
          )}
       </MenuOptionGroup>
     </MenuList>
   </Menu>
   );
}
