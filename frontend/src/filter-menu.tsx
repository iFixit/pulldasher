import { useAllOpenPulls, useSetFilter } from './pulldasher/pulls-context';
import { useArrayUrlState } from './use-url-state';
import { Pull } from './pull';
import { useConst, Button, Menu, MenuButton, MenuList, MenuDivider, MenuOptionGroup, MenuItemOption } from "@chakra-ui/react";
import { useEffect, useMemo } from 'react'
import { countBy } from 'lodash-es'

// Map from value to number of pulls that have that value
type ValueGetter = (pull: Pull) => string;

type FilterMenuProps = {
   urlParam: string,
   buttonText: string,
   extractValueFromPull: ValueGetter,
};

export function FilterMenu({urlParam, buttonText, extractValueFromPull}: FilterMenuProps) {
   const pulls = useAllOpenPulls();
   // Default is empty array that implies show all pulls (no filtering)
   const [selectedValues, setSelectedValues] = useArrayUrlState(urlParam, []);
   // Nothing selected == show everything, otherwise, it'd be empty
   const showAll = selectedValues.length === 0;
   // List from url may contain values we have no pulls for
   const urlValues = useConst(() => new Set(selectedValues));
   const setPullFilter = useSetFilter();

   // May include values from the url for which there are no pulls
   const allValues = useMemo(() => {
      // All values of open pulls
      const pullValues = new Set<string>(pulls.map(extractValueFromPull));
      return sortValues([...new Set([...pullValues, ...urlValues])]);
   }, [pulls]);
   const valueToPullCount = useMemo(() => countBy(pulls, extractValueFromPull), [pulls]);

   useEffect(() => {
      const selectedValuesSet = new Set(selectedValues);
      setPullFilter(urlParam, selectedValuesSet.size === 0 ? null : (pull) =>
         selectedValuesSet.has(extractValueFromPull(pull))
      );
   }, [selectedValues]);

   return (
   <Menu closeOnSelect={false}>
     <MenuButton as={Button} colorScheme='blue' size="sm" variant={showAll ? 'outline' : null}>
       {buttonText} {selectedValues.length ? `(${selectedValues.length})` : ''}
     </MenuButton>
     <MenuList minWidth='240px'>
       <MenuItemOption
          key="Show All"
          onClick={() => setSelectedValues([])}
          isChecked={showAll}>
          Show All
       </MenuItemOption>
        <MenuDivider/>
        <MenuOptionGroup
           type='checkbox'
           value={showAll ? [] : selectedValues}
           onChange={setSelectedValues}>
          {allValues.map((value) =>
             <MenuItemOption
                key={value}
                value={value}>
                {value} ({valueToPullCount[value] || 0})
             </MenuItemOption>
          )}
       </MenuOptionGroup>
     </MenuList>
   </Menu>
   );
}

function sortValues(values: string[]): string[] {
   return values.sort((a: string, b: string) =>
      a.localeCompare(b, undefined, {sensitivity: "base"}));
}
