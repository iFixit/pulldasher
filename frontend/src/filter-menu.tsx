import { useAllOpenPulls, useSetFilter } from "./pulldasher/pulls-context";
import { useArrayUrlState } from "./use-url-state";
import { Pull } from "./pull";
import {
  useConst,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuDivider,
  MenuOptionGroup,
  MenuItemOption,
  chakra,
} from "@chakra-ui/react";
import { useEffect, useMemo } from "react";
import { countBy } from "lodash-es";

// Map from value to number of pulls that have that value
type ValueGetter = (pull: Pull) => string;

const SHOWALL = "SHOWALL";

type FilterMenuProps = {
  urlParam: string;
  buttonText: string;
  extractValueFromPull: ValueGetter;
  defaultExculdedValues?: string[];
};

export function FilterMenu({
  urlParam,
  buttonText,
  extractValueFromPull,
  defaultExculdedValues,
}: FilterMenuProps) {
  const pulls = useAllOpenPulls();
  // Default is empty array that implies show all pulls (no filtering)
  const [selectedValues, setSelectedValues] = useArrayUrlState(urlParam, []);
  // Nothing selected == show the default values (everything except the excluded values)
  const showDefault = selectedValues.length === 0;
  // Show every single value if the magic SHOWALL string is selected
  const showAll = notEmpty(defaultExculdedValues) ? selectedValues.includes(SHOWALL) : selectedValues.length === 0;

  // List from url may contain values we have no pulls for
  const urlValues = useConst(() => new Set(selectedValues));
  const setPullFilter = useSetFilter();

  // May include values from the url for which there are no pulls
  const allValues = useMemo(() => {
    // All values of open pulls
    const pullValues = new Set<string>(pulls.map(extractValueFromPull));
    const allValuesSet = new Set([...pullValues, ...urlValues]);
    allValuesSet.delete(SHOWALL);
    return sortValues([...allValuesSet]);
  }, [pulls]);

  const valueToPullCount = useMemo(
    () => countBy(pulls, extractValueFromPull),
    [pulls]
  );

  const defaultSelectedValues = arrayDiff(allValues, defaultExculdedValues || []);

  useEffect(() => {
    const selectedValuesSet = new Set(selectedValues);
    setPullFilter(
      urlParam,
      showAll
        ? null
        : (showDefault ? (pull) => !defaultExculdedValues?.includes(extractValueFromPull(pull))
          : (pull) => selectedValuesSet.has(extractValueFromPull(pull)))
    );
  }, [selectedValues, defaultExculdedValues]);

  const numberText = showDefault ? "" : (showAll ? allValues.length : selectedValues.length);

  return (
    <Menu closeOnSelect={false}>
      <MenuButton
        as={Button}
        colorScheme="blue"
        size="sm"
        variant={showDefault ? "outline" : null}
      >
        {buttonText} {numberText ? `(${numberText})` : ""}
      </MenuButton>
      <MenuList minWidth="240px">
        {notEmpty(defaultExculdedValues) && (
          <>
            <MenuItemOption
              key="Show All"
              onClick={() => setSelectedValues([SHOWALL])}
            >
              Show All
            </MenuItemOption>
            <MenuItemOption
              key="Show Default"
              onClick={() => setSelectedValues([])}
            >
              Show Default
            </MenuItemOption>
          </>)
        }
        {empty(defaultExculdedValues) &&
          <MenuItemOption
            key="Show All"
            onClick={() => setSelectedValues([])}
          >
            Show All
          </MenuItemOption>
        }
        <MenuDivider />
        <MenuOptionGroup
          type="checkbox"
          value={showAll ? allValues : (showDefault ? defaultSelectedValues : selectedValues)}
          onChange={setSelectedValues}
        >
          {allValues.map((value) => (
            <MenuItemOption className="filterOption" key={value} value={value}>
              {value} ({valueToPullCount[value] || 0})
              <chakra.span
                visibility="hidden"
                float="right"
                _hover={{textDecoration:"underline"}}
                mt={1}
                fontSize="xs"
                sx={{'.filterOption:hover &': {visibility: 'visible'}}}
                onClick={(e)=> {
                  setSelectedValues([value]);
                  e.stopPropagation();
                }
              }>only</chakra.span>
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
      </MenuList>
    </Menu>
  );
}

function sortValues(values: string[]): string[] {
  return values.sort((a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function arrayDiff<T>(a: T[], b: T[]): T[] {
  return a.filter((x) => !b.includes(x));
}

function empty<T>(array: T[] | undefined): boolean {
  return !array || array.length === 0;
}

function notEmpty<T>(array: T[] | undefined): boolean {
  return !!array && array.length > 0;
}
