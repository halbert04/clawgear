import { createConnection } from './pg/connection.js';
import { agents, companies, goals } from './pg/schema.js';

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://clawgear:clawgear@localhost:5432/clawgear';
  const { db, client } = createConnection(url);

  try {
    console.log('Seeding database...');

    // Create sample company
    const [company] = await db
      .insert(companies)
      .values({
        name: 'Acme Corp',
        description: 'Sample company for development',
        issuePrefix: 'ACME',
        budgetMonthlyCents: 100000n,
        requireBoardApproval: true,
      })
      .returning();

    if (!company) throw new Error('Failed to create company');
    console.log(`Created company: ${company.name} (${company.id})`);

    // Create CEO agent
    const [ceo] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: 'Atlas',
        title: 'Chief Executive Officer',
        role: 'ceo',
        icon: '👔',
        capabilities: [],
        adapterType: 'claude_code',
        modelTier: 'frontier',
        budgetMonthlyCents: 50000n,
        systemPrompt:
          'You are Atlas, the CEO of Acme Corp. You oversee strategy, delegate work, and ensure quality.',
      })
      .returning();

    if (!ceo) throw new Error('Failed to create CEO');
    console.log(`Created CEO: ${ceo.name} (${ceo.id})`);

    // Create engineer agent
    const [engineer] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: 'Nova',
        title: 'Senior Engineer',
        role: 'engineer',
        icon: '⚡',
        reportsTo: ceo.id,
        capabilities: [
          { type: 'file_read', glob: '**/*' },
          { type: 'file_write', glob: 'src/**/*' },
          { type: 'shell_exec', commands: ['npm', 'git', 'bun'] },
        ],
        adapterType: 'claude_code',
        modelTier: 'smart',
        budgetMonthlyCents: 30000n,
        systemPrompt:
          'You are Nova, a senior engineer at Acme Corp. You write high-quality code and solve technical problems.',
      })
      .returning();

    if (!engineer) throw new Error('Failed to create engineer');
    console.log(`Created engineer: ${engineer.name} (${engineer.id})`);

    // Create company mission goal
    const [missionGoal] = await db
      .insert(goals)
      .values({
        companyId: company.id,
        level: 'company',
        ownerAgentId: ceo.id,
        title: 'Build a world-class product',
        description: 'Deliver exceptional value to customers through innovative technology.',
      })
      .returning();

    if (!missionGoal) throw new Error('Failed to create mission goal');
    console.log(`Created mission goal: ${missionGoal.title} (${missionGoal.id})`);

    console.log('\nSeed complete!');
    console.log(`  Company ID: ${company.id}`);
    console.log(`  CEO ID: ${ceo.id}`);
    console.log(`  Engineer ID: ${engineer.id}`);
    console.log(`  Mission Goal ID: ${missionGoal.id}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
