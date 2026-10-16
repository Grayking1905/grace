import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Database } from './db.js';
import { projectTemplates } from '../shared/templates.js';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function dateOffset(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const demoWorkspace = 'workspace-grace';
export const demoUser = 'user-alex';
export async function createStatuses(
  db: Database,
  workspaceId: string,
  projectId: string,
  template: keyof typeof projectTemplates = 'scrum',
) {
  const configuration = projectTemplates[template];
  const list = configuration.statuses;
  for (let i = 0; i < list.length; i++)
    await db.insert('statuses', {
      id: id(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: list[i][0],
      category: list[i][1],
      color: list[i][2],
      position: i,
      wip_limit: list[i][1] === 'active' ? (template === 'kanban' ? 3 : 6) : 0,
    });
  await db.insert('project_configuration', {
    project_id: projectId,
    issue_types: JSON.stringify(configuration.types),
    default_type: configuration.defaultType,
    cycles_enabled: configuration.cycles ? 1 : 0,
  });
}
export async function seed(db: Database) {
  if (await db.one('SELECT id FROM workspaces WHERE id = ?', [demoWorkspace])) return;
  const passwordHash = await bcrypt.hash('GraceDemo2026!', 12);
  await db.transaction(async () => {
    await db.insert('workspaces', {
      id: demoWorkspace,
      name: 'Grace Studio',
      slug: 'grace-studio',
      created_at: now(),
    });
    const people = [
      ['user-alex', 'Alex Morgan', '#d9e8de', 'owner'],
      ['user-sarah', 'Sarah Chen', '#ece0f4', 'member'],
      ['user-james', 'James Wilson', '#dfe9f6', 'member'],
      ['user-priya', 'Priya Sharma', '#f5e5d6', 'admin'],
      ['user-noah', 'Noah Park', '#e2e8d3', 'member'],
    ];
    for (const [uid, name, color, role] of people) {
      await db.insert('users', {
        id: uid,
        name,
        email: `${name.split(' ')[0].toLowerCase()}@grace.local`,
        password_hash: passwordHash,
        color,
        capacity: 40,
        created_at: now(),
      });
      await db.insert('memberships', {
        workspace_id: demoWorkspace,
        user_id: uid,
        role,
      });
    }
    const projects = [
      [
        'project-platform',
        'Grace platform',
        'GRC',
        'A calmer way to plan, build, and ship great work.',
        '#e9e3f5',
        'layers',
      ],
      [
        'project-mobile',
        'Mobile experience',
        'MOB',
        'Thoughtful experiences for teams on the move.',
        '#dcece5',
        'smartphone',
      ],
      [
        'project-website',
        'Website refresh',
        'WEB',
        'Tell our story. Make every first impression count.',
        '#f7e9d9',
        'globe',
      ],
    ];
    const summaries = [
      'Design the workspace onboarding flow',
      'Build the project overview dashboard',
      'Add keyboard shortcuts for quick actions',
      'Set up the design token system',
      'Fix filter state on page navigation',
      'Create the issue detail side panel',
      'Implement real-time board updates',
      'Refine empty states and illustrations',
      'Add CSV export for project issues',
      'Review accessibility across core flows',
      'Write the getting started guide',
      'Implement email notification preferences',
      'Map the mobile navigation structure',
      'Build responsive issue cards',
      'Add pull-to-refresh interaction',
      'Improve touch target accessibility',
      'Design the offline experience',
      'Fix board overflow on small screens',
      'Test navigation on iOS Safari',
      'Add mobile push notification settings',
      'Explore the new visual direction',
      'Write the homepage story',
      'Build the product features page',
      'Optimize images and font loading',
      'Update the pricing comparison',
      'Create customer story templates',
      'Connect the contact form',
      'Review SEO and page metadata',
    ];
    let offset = 0;
    for (let p = 0; p < projects.length; p++) {
      const [pid, name, key, description, color, icon] = projects[p];
      const count = p === 0 ? 12 : 8;
      await db.insert('projects', {
        id: pid,
        workspace_id: demoWorkspace,
        name,
        key,
        description,
        color,
        icon,
        lead_id: people[p][0],
        template: 'scrum',
        favorite: 1,
        next_number: count + 1,
        created_at: dateOffset(-35),
      });
      for (const person of people)
        await db.insert('project_members', {
          workspace_id: demoWorkspace,
          project_id: pid,
          user_id: person[0],
          role: person[3] === 'owner' ? 'admin' : person[3],
        });
      await createStatuses(db, demoWorkspace, pid);
      const statuses = await db.all<{ id: string; category: string }>(
        'SELECT * FROM statuses WHERE project_id = ? ORDER BY position',
        [pid],
      );
      const sprintId = `sprint-${p}-current`;
      for (let s = 0; s < 4; s++)
        await db.insert('sprints', {
          id: s === 3 ? sprintId : `sprint-${p}-${s}`,
          workspace_id: demoWorkspace,
          project_id: pid,
          name: `Sprint ${s + 5}`,
          goal:
            s === 3
              ? 'Make the essentials feel effortless.'
              : 'Ship the foundation for a better team experience.',
          state: s === 3 ? 'active' : 'closed',
          start_date: dateOffset((s - 3) * 14 - 5),
          end_date: dateOffset((s - 3) * 14 + 8),
          committed_points: [21, 26, 30, 27][s],
          completed_points: [18, 23, 27, 0][s],
        });
      for (let i = 0; i < count; i++) {
        const status = statuses[[1, 1, 0, 3, 0, 2, 1, 2, 3, 0, 3, 0][i]];
        const issueId = `issue-${p}-${i}`;
        const createdAt = `${dateOffset(-14 + (i % 5))}T09:00:00.000Z`;
        await db.insert('issues', {
          id: issueId,
          workspace_id: demoWorkspace,
          project_id: pid,
          number: i + 1,
          key: `${key}-${i + 1}`,
          summary: summaries[offset + i],
          description: `<p>Let's make this part of the ${name.toLowerCase()} feel clear and effortless.</p><h3>Acceptance criteria</h3><ul><li>Works across desktop and mobile</li><li>Includes thoughtful loading, empty, and error states</li><li>Reviewed by the team before release</li></ul>`,
          type: i === 4 || (i === 5 && p === 1) ? 'bug' : i % 4 === 0 ? 'story' : 'task',
          status_id: status.id,
          priority: [
            'high',
            'high',
            'medium',
            'low',
            'critical',
            'medium',
            'high',
            'low',
            'medium',
            'high',
            'low',
            'medium',
          ][i],
          assignee_id: i === 9 ? null : people[i % 5][0],
          reporter_id: demoUser,
          sprint_id: i >= count - 2 ? null : sprintId,
          labels: JSON.stringify([
            ['Design', 'Frontend', 'Experience', 'Foundation', 'Bug'][i % 5],
          ]),
          story_points: [5, 8, 3, 2, 3, 5, 8, 3, 2, 5, 2, 3][i],
          due_date: dateOffset((i % 7) - 2),
          start_date: dateOffset(-7 + (i % 3)),
          rank: (i + 1) * 1000,
          flagged: i === 4 && p === 0 ? 1 : 0,
          created_at: createdAt,
          updated_at: `${dateOffset(-i % 4)}T12:00:00.000Z`,
        });
        await db.insert('history', {
          id: id(),
          workspace_id: demoWorkspace,
          issue_id: issueId,
          actor_id: people[i % 5][0],
          field: 'created',
          old_value: '',
          new_value: summaries[offset + i],
          created_at: createdAt,
        });
        if (status.category !== 'todo')
          await db.insert('history', {
            id: id(),
            workspace_id: demoWorkspace,
            issue_id: issueId,
            actor_id: people[i % 5][0],
            field: 'status_id',
            old_value: statuses[0].id,
            new_value: status.id,
            created_at: `${dateOffset(-4 + (i % 4))}T10:30:00.000Z`,
          });
        await db.insert('watchers', {
          workspace_id: demoWorkspace,
          issue_id: issueId,
          user_id: people[i % 5][0],
        });
      }
      offset += count;
    }
    await db.insert('comments', {
      id: id(),
      workspace_id: demoWorkspace,
      issue_id: 'issue-0-0',
      author_id: 'user-sarah',
      body: 'The first pass is ready for review. I focused on keeping the number of steps low and making the workspace feel welcoming.',
      created_at: now(),
    });
    for (const [title, content, icon] of [
      [
        'Welcome to Grace',
        '<h2>A little more clarity. A lot more progress.</h2><p>This is your shared home for ideas, decisions, and the work that matters.</p><h3>Find your flow</h3><ul><li>Use projects to bring related work together.</li><li>Plan a sprint around a clear, achievable goal.</li><li>Keep decisions close to the work with Pages.</li></ul><p>Press <strong>C</strong> to create an issue or <strong>Ctrl + K</strong> to find anything.</p>',
        'sparkles',
      ],
      [
        'Design principles',
        '<h2>Thoughtful by default</h2><p>Clarity over clutter. Familiar patterns. Quiet confidence.</p><h3>Our principles</h3><ol><li>Make the next step obvious.</li><li>Respect people’s attention.</li><li>Design for everyone.</li><li>Make the everyday details feel good.</li></ol>',
        'palette',
      ],
      [
        'Sprint 8 · Planning notes',
        '<h2>Make the essentials feel effortless</h2><p>This sprint is about the moments teams use every day: creating work, finding it, and moving it forward.</p><h3>Discussion points</h3><ul><li>Review scope against team capacity.</li><li>Prioritize accessibility fixes.</li><li>Leave space for feedback.</li></ul>',
        'notebook',
      ],
    ])
      await db.insert('pages', {
        id: id(),
        workspace_id: demoWorkspace,
        project_id: 'project-platform',
        title,
        content,
        icon,
        author_id: demoUser,
        updated_at: now(),
      });
    await db.insert('saved_views', {
      id: id(),
      workspace_id: demoWorkspace,
      name: 'High priority',
      query: "priority in ('high', 'critical') AND status != 'Done'",
      owner_id: demoUser,
      sharing: 'workspace',
    });
    await db.insert('saved_views', {
      id: id(),
      workspace_id: demoWorkspace,
      name: 'My open work',
      query: "assignee = currentUser() AND status != 'Done'",
      owner_id: demoUser,
      sharing: 'private',
    });
    for (const [i, person] of people.entries()) {
      await db.insert('standups', {
        id: id(),
        workspace_id: demoWorkspace,
        user_id: person[0],
        yesterday: [
          'Finished the design token review.',
          'Explored the onboarding flow.',
          'Set up real-time event handlers.',
          'Reviewed accessibility findings.',
          'Updated the getting started guide.',
        ][i],
        today: [
          'Polish the workspace dashboard.',
          'Refine the issue detail panel.',
          'Connect board updates to the API.',
          'Test keyboard navigation.',
          'Review sprint documentation.',
        ][i],
        blockers: i === 2 ? 'Waiting on the filter state fix.' : '',
        created_at: now(),
      });
    }
    await db.insert('risks', {
      id: id(),
      workspace_id: demoWorkspace,
      project_id: 'project-platform',
      title: 'Filter state regression may affect the release',
      severity: 'high',
      state: 'open',
      owner_id: 'user-james',
      created_at: now(),
    });
    for (const [title, body, issueId] of [
      ['Sarah left a comment', 'The onboarding flow is ready for your feedback.', 'issue-0-0'],
      ['You have new work', 'Review accessibility across core flows.', 'issue-0-9'],
      ['Sprint 8 is underway', 'Make the essentials feel effortless.', 'issue-0-1'],
    ])
      await db.insert('notifications', {
        id: id(),
        workspace_id: demoWorkspace,
        user_id: demoUser,
        issue_id: issueId,
        title,
        body,
        created_at: now(),
      });
  });
}
