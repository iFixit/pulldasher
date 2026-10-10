import { bucketOf, planEnd } from '../shared/dist/index.js';

/**
 * Copying the roadmap into GitHub's issue fields, so a plan's dates and
 * priority show on its project's issue, and on every project board that
 * lists the issue, where a team already looks. bin/sync-issue-fields runs
 * it; the server itself never writes them.
 *
 * A value a person chose is theirs: a field is written only when nobody has
 * set it yet, or when this token made its last change. Anything else is
 * reported, so a date moved on a board is never quietly moved back.
 */

/** Each field's name, as every organization's defaults spell it. */
export const FIELD_NAMES = { start: 'Start date', target: 'Target date', priority: 'Priority' };
const KEYS = Object.keys(FIELD_NAMES);

// the roadmap's now, next and later, as GitHub's priorities
const PRIORITY_OF = { now: 'High', next: 'Medium', later: 'Low' };

/**
 * What the fields should say for a plan under way: its first week's Monday,
 * its planned last day, and a priority: Urgent for a fire, else High for
 * work now, Medium for work starting within a quarter, Low for later.
 */
export function wantedFields(plan, today) {
   return {
      start: plan.start,
      target: planEnd(plan),
      priority: plan.origin === 'fire' ? 'Urgent' : PRIORITY_OF[bucketOf(plan, today)],
   };
}

/** Who last changed each field, from an issue's field events (oldest
 * first, as GraphQL's timelineItems returns them); a key is left out when
 * nobody ever set that field. */
export function lastActors(events) {
   const byName = new Map(
      Object.entries(FIELD_NAMES).map(([key, name]) => [name.toLowerCase(), key])
   );
   const out = {};
   for (const event of events || []) {
      const key = byName.get(String(event?.issueField?.name || '').toLowerCase());
      if (key) out[key] = event.actor?.login ?? null;
   }
   return out;
}

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/**
 * Which fields to write on one issue, and which to leave. `current` is what
 * the issue says ({ start, target, priority }, git-manager's
 * fieldsFromNodes), `actors` who last changed each (lastActors), `me` this
 * token's login.
 */
export function fieldWrites({ current, wanted, actors, me }) {
   const writes = [];
   const kept = [];
   for (const key of KEYS) {
      if (same(current[key], wanted[key])) continue;
      const by = actors[key];
      const mine = by != null && me != null && by.toLowerCase() === me.toLowerCase();
      if (mine || (by === undefined && current[key] == null)) writes.push(key);
      else kept.push({ key, value: current[key], by: by ?? null });
   }
   return { writes, kept };
}

/**
 * setIssueFieldValue's input for one issue. `fields` is the organization's
 * issue fields (orgFields), by key. A priority with no matching option is
 * left out rather than sent wrong.
 */
export function mutationInput(issueId, writes, wanted, fields) {
   const issueFields = writes.flatMap(key => {
      const field = fields[key];
      if (!field) return [];
      if (key !== 'priority') return [{ fieldId: field.id, dateValue: wanted[key] }];
      const option = field.options.find(o => same(o.name, wanted.priority));
      return option ? [{ fieldId: field.id, singleSelectOptionId: option.id }] : [];
   });
   return { issueId, issueFields };
}

/** An organization's issue fields (GraphQL nodes) by key, for the three this
 * copies; a renamed or deleted one is missing. */
export function orgFields(nodes) {
   const out = {};
   for (const [key, name] of Object.entries(FIELD_NAMES)) {
      const node = (nodes || []).find(n => same(n?.name, name));
      if (node) out[key] = { id: node.id, options: node.options || [] };
   }
   return out;
}

const fieldName = '... on IssueFieldDate { name } ... on IssueFieldSingleSelect { name }';
const event = type => `... on ${type} { actor { login } issueField { ${fieldName} } }`;

export const ISSUE_STATE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
   repository(owner: $owner, name: $name) {
      issue(number: $number) {
         id
         issueFieldValues(first: 25) {
            nodes {
               ... on IssueFieldDateValue { value field { ... on IssueFieldDate { name } } }
               ... on IssueFieldSingleSelectValue {
                  name
                  field { ... on IssueFieldSingleSelect { name } }
               }
            }
         }
         timelineItems(
            last: 50
            itemTypes: [ISSUE_FIELD_ADDED_EVENT, ISSUE_FIELD_CHANGED_EVENT, ISSUE_FIELD_REMOVED_EVENT]
         ) {
            nodes {
               ${event('IssueFieldAddedEvent')}
               ${event('IssueFieldChangedEvent')}
               ${event('IssueFieldRemovedEvent')}
            }
         }
      }
   }
}`;

export const ORG_FIELDS_QUERY = `query($login: String!) {
   organization(login: $login) {
      issueFields(first: 25) {
         nodes {
            ... on IssueFieldDate { id name }
            ... on IssueFieldSingleSelect { id name options { id name } }
         }
      }
   }
}`;

export const SET_FIELDS_MUTATION = `mutation($input: SetIssueFieldValueInput!) {
   setIssueFieldValue(input: $input) { clientMutationId }
}`;
