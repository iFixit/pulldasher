import { useAllPulls, useSetFilter } from './pulldasher/pulls-context';
import { useArrayUrlState } from './use-url-state';
import { Pull } from './pull';
import { useConst, Button, Menu, MenuButton, MenuList, MenuDivider, MenuOptionGroup, MenuItemOption } from "@chakra-ui/react";
import { useEffect, useCallback, useMemo } from 'react'

// Map from value to number of pulls that have that value
type ValueCounts = Map<string, number>;
type ValueGetter = (pull: Pull) => string;

type FilterMenuProps = {
   urlParam: string,
   buttonText: string,
   extractValueFromPull: ValueGetter,
};

export function FilterMenu({urlParam, buttonText, extractValueFromPull}: FilterMenuProps) {
   const pulls = useAllPulls();
   // Default is empty array that implies show all pulls (no filtering)
   const [selectedValues, setSelectedValues] = useArrayUrlState(urlParam, []);
   // Nothing selected == show everything, otherwise, it'd be empty
   const showAll = selectedValues.length === 0;
   // List from url may contain values we have no pulls for
   const urlValues = useConst(() => new Set(selectedValues));
   const setPullFilter = useSetFilter();

   // May include values frmo the url for which there are no pulls
   const allValues = useMemo(() => {
      // All values of open pulls
      const pullValues = new Set<string>(pulls.map(extractValueFromPull));
      return [...new Set([...pullValues, ...urlValues])]
   }, [pulls]);
   const valueToPullCount = useMemo(() => getValueToPullCount(pulls, extractValueFromPull), [pulls]);

   const onSelectedChange = useCallback((newSelectedValues: string | string[]) => {
      // Make typescript happy cause it thinks newSelectedValues can be a single
      // string
      newSelectedValues = Array.from(newSelectedValues);

      // Update the url
      setSelectedValues(newSelectedValues);

      // Update the pull filter
      const selectedValuesSet = new Set(newSelectedValues);
      setPullFilter(urlParam, selectedValuesSet.size === 0 ? null : (pull) =>
         selectedValuesSet.has(extractValueFromPull(pull))
      );
   }, [setPullFilter, setSelectedValues]);

   // Load initial state from url just once
   useEffect(() => onSelectedChange(selectedValues), []);

   return (
   <Menu closeOnSelect={false}>
     <MenuButton as={Button} colorScheme='blue' size="sm" variant="outline">
       {buttonText}
     </MenuButton>
     <MenuList minWidth='240px'>
        <MenuOptionGroup
           type='checkbox'
           value={showAll ? allValues : selectedValues}
           onChange={onSelectedChange}>
          {allValues.map((value) =>
             <MenuItemOption
                key={value}
                value={value}>
                {value} ({valueToPullCount.get(value) || 0})
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

function getValueToPullCount(pulls: Pull[], extractValueFromPull: ValueGetter): ValueCounts {
   return pulls.reduce((counts, pull) => {
      const pullKey = extractValueFromPull(pull);
      counts.set(pullKey, (counts.get(pullKey) || 0) + 1);
      return counts;
   }, new Map() as ValueCounts);
}
