import type { Issue, Status, Project, Sprint, User } from '../shared/types.js';
type Context = {
  user: User;
  statuses: Status[];
  projects: Project[];
  members: User[];
  sprints: Sprint[];
};
export class QueryError extends Error {}
type Predicate = (issue: Issue) => boolean;
// This is a parser, never an SQL interpolator or JavaScript evaluator.
export function queryIssues(query: string, issues: Issue[], ctx: Context): Issue[] {
  if (issues.length > 20000)
    throw new QueryError(
      'This query exceeds the 20,000-issue evaluation budget. Narrow the project scope.',
    );
  const tokens: string[] = [];
  let rest = query.trim();
  while (rest) {
    const match =
      /^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(!=|>=|<=|[=~><(),])|([\w@.:-]+))/.exec(rest);
    if (!match) throw new QueryError(`Unexpected text near “${rest.slice(0, 24)}”.`);
    tokens.push(match[0]);
    rest = rest.slice(match[0].length).trimStart();
    if (tokens.length > 200) throw new QueryError('Please use a shorter query.');
  }
  let pos = 0;
  const peek = () => tokens[pos]?.toUpperCase();
  const consume = () => tokens[pos++];
  const expect = (value: string) => {
    if (peek() !== value)
      throw new QueryError(`Expected ${value}, received ${tokens[pos] || 'end of query'}.`);
    consume();
  };
  const fields = [
    'project',
    'status',
    'assignee',
    'reporter',
    'priority',
    'type',
    'label',
    'labels',
    'sprint',
    'points',
    'due',
    'key',
    'summary',
    'text',
    'flagged',
  ];
  const fieldValue = (issue: Issue, field: string): (string | number | null)[] => {
    switch (field) {
      case 'project': {
        const p = ctx.projects.find((p) => p.id === issue.project_id);
        return [p?.key || '', p?.name || '', issue.project_id];
      }
      case 'status': {
        const s = ctx.statuses.find((s) => s.id === issue.status_id);
        return [s?.name || '', s?.category || '', issue.status_id];
      }
      case 'assignee':
      case 'reporter': {
        const uid = field === 'assignee' ? issue.assignee_id : issue.reporter_id;
        const u = ctx.members.find((m) => m.id === uid);
        return uid ? [uid, u?.name || '', u?.email || ''] : [null];
      }
      case 'label':
      case 'labels':
        return issue.labels.length ? issue.labels : [null];
      case 'sprint':
        return issue.sprint_id
          ? [issue.sprint_id, ctx.sprints.find((s) => s.id === issue.sprint_id)?.name || '']
          : [null];
      case 'points':
        return [issue.story_points];
      case 'due':
        return [issue.due_date || null];
      case 'text':
        return [issue.summary, issue.description.replace(/<[^>]*>/g, '')];
      case 'flagged':
        return [issue.flagged ? 'true' : 'false'];
      default:
        return [issue[field as keyof Issue] as string];
    }
  };
  const readValue = (): string[] => {
    const token = consume();
    if (!token || [')', ',', '(', '=', '!='].includes(token))
      throw new QueryError('A comparison value is required.');
    if (peek() === '(') {
      consume();
      expect(')');
      if (token.toLowerCase() === 'currentuser') return [ctx.user.id];
      if (token.toLowerCase() === 'opensprints')
        return ctx.sprints.filter((s) => s.state === 'active').map((s) => s.id);
      if (token.toLowerCase() === 'now') return [new Date().toISOString().slice(0, 10)];
      if (token.toLowerCase() === 'startofweek') {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return [d.toISOString().slice(0, 10)];
      }
      throw new QueryError(`Unknown function ${token}().`);
    }
    return [token.replace(/^['"]|['"]$/g, '').replace(/\\(['"\\])/g, '$1')];
  };
  const norm = (v: unknown) => String(v ?? '').toLowerCase();
  const clause = (): Predicate => {
    const field = (consume() || '').toLowerCase();
    if (!fields.includes(field))
      throw new QueryError(
        `Unknown field “${field}”. Try project, status, assignee, priority, type, label, sprint, or text.`,
      );
    let operator = consume()?.toUpperCase();
    if (operator === 'IS') {
      const negative = peek() === 'NOT';
      if (negative) consume();
      expect('EMPTY');
      return (issue) => fieldValue(issue, field).every((v) => v === null || v === '') !== negative;
    }
    if (operator === 'NOT') {
      expect('IN');
      operator = 'NOT IN';
    }
    let values: string[] = [];
    if (operator === 'IN' || operator === 'NOT IN') {
      expect('(');
      values.push(...readValue());
      while (peek() === ',') {
        consume();
        values.push(...readValue());
      }
      expect(')');
    } else {
      if (!operator || !['=', '!=', '~', '>', '<', '>=', '<='].includes(operator))
        throw new QueryError('Expected =, !=, ~, in, not in, is empty, >, or <.');
      values = readValue();
    }
    return (issue) => {
      const actual = fieldValue(issue, field);
      const matched = actual.some((a) =>
        values.some((b) => {
          if (operator === '~') return norm(a).includes(norm(b));
          if (['>', '<', '>=', '<='].includes(operator!)) {
            if (a === null) return false;
            const x = field === 'points' ? Number(a) : String(a);
            const y = field === 'points' ? Number(b) : b;
            return operator === '>'
              ? x > y
              : operator === '<'
                ? x < y
                : operator === '>='
                  ? x >= y
                  : x <= y;
          }
          return norm(a) === norm(b);
        }),
      );
      return operator === '!=' || operator === 'NOT IN' ? !matched : matched;
    };
  };
  const atom = (): Predicate => {
    if (peek() === 'NOT') {
      consume();
      const p = atom();
      return (i) => !p(i);
    }
    if (peek() === '(') {
      consume();
      const p = or();
      expect(')');
      return p;
    }
    return clause();
  };
  const and = (): Predicate => {
    let a = atom();
    while (peek() === 'AND') {
      consume();
      const b = atom();
      const prev = a;
      a = (i) => prev(i) && b(i);
    }
    return a;
  };
  const or = (): Predicate => {
    let a = and();
    while (peek() === 'OR') {
      consume();
      const b = and();
      const prev = a;
      a = (i) => prev(i) || b(i);
    }
    return a;
  };
  let result = [...issues];
  if (pos < tokens.length && peek() !== 'ORDER') result = result.filter(or());
  if (peek() === 'ORDER') {
    consume();
    expect('BY');
    const field = consume()?.toLowerCase() || '';
    if (!fields.includes(field)) throw new QueryError('Unknown sort field.');
    const direction = peek() === 'DESC' ? -1 : 1;
    if (peek() === 'DESC' || peek() === 'ASC') consume();
    const priority = { lowest: 0, low: 1, medium: 2, high: 3, critical: 4 };
    result.sort(
      (a, b) =>
        direction *
        (field === 'priority'
          ? priority[a.priority] - priority[b.priority]
          : norm(fieldValue(a, field)[0]).localeCompare(norm(fieldValue(b, field)[0]), undefined, {
              numeric: true,
            })),
    );
  }
  if (pos !== tokens.length) throw new QueryError(`Unexpected token “${tokens[pos]}”.`);
  return result;
}
