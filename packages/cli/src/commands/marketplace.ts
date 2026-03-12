import type { Command } from 'commander';

interface SkillListItem {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
}

export function registerMarketplaceCommands(program: Command) {
  const skill = program
    .command('skill')
    .description('GearHub marketplace — publish, install, and search skills');

  // clawgear skill search <query>
  skill
    .command('search <query>')
    .description('Search for skills in the marketplace')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .option('--tag <tag>', 'Filter by tag')
    .option('--author <author>', 'Filter by author')
    .action(
      async (
        query: string,
        opts: { company: string; url: string; tag?: string; author?: string },
      ) => {
        try {
          const params = new URLSearchParams({ q: query, limit: '50' });
          if (opts.tag) params.set('tag', opts.tag);
          if (opts.author) params.set('author', opts.author);

          const res = await fetch(
            `${opts.url}/api/companies/${opts.company}/marketplace?${params}`,
          );
          if (!res.ok) {
            console.error(`Search failed: ${res.status}`);
            process.exit(1);
          }
          const body = (await res.json()) as { data: SkillListItem[]; total: number };

          if (body.data.length === 0) {
            console.log(`No skills found for "${query}"`);
            return;
          }

          console.log(`Found ${body.total} skill(s):\n`);
          for (const s of body.data) {
            const tags = s.tags.length > 0 ? ` [${(s.tags as string[]).join(', ')}]` : '';
            console.log(`  ${s.name}@${s.version} — ${s.description}${tags}`);
            console.log(`    by ${s.author} | ${s.downloads} downloads`);
          }
        } catch (err) {
          console.error(`Error: ${String(err)}`);
          process.exit(1);
        }
      },
    );

  // clawgear skill install <name>
  skill
    .command('install <name>')
    .description('Install a skill from the marketplace')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/marketplace/${name}/install`,
          { method: 'POST' },
        );
        if (!res.ok) {
          const body = (await res.json()) as { error: string };
          console.error(`Install failed: ${body.error}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          manifest: { name: string; version: string; author: string; checksum: string };
          signature: string;
          publisherKey: string;
        };
        const m = body.manifest;
        console.log(`Installed ${m.name}@${m.version} by ${m.author}`);
        console.log(`  Checksum: ${m.checksum}`);
        console.log(`  Signed by: ${body.publisherKey.slice(0, 16)}...`);
      } catch (err) {
        console.error(`Error: ${String(err)}`);
        process.exit(1);
      }
    });

  // clawgear skill publish
  skill
    .command('publish <dir>')
    .description('Publish a skill to the marketplace')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--key <privateKeyHex>', 'Ed25519 private key (hex)')
    .requiredOption('--pubkey <publicKeyHex>', 'Ed25519 public key (hex)')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(
      async (dir: string, opts: { company: string; key: string; pubkey: string; url: string }) => {
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');

          // Read skill files
          const resolvedDir = path.resolve(dir);
          const files: Record<string, string> = {};
          const entries = fs.readdirSync(resolvedDir, { recursive: true, withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) {
              const fullPath = path.join(
                entry.parentPath ?? (entry as unknown as { path: string }).path,
                entry.name,
              );
              const relPath = path.relative(resolvedDir, fullPath);
              files[relPath] = fs.readFileSync(fullPath, 'utf-8');
            }
          }

          // Parse HAND.toml for manifest info
          const handToml = files['HAND.toml'];
          if (!handToml) {
            console.error('Error: No HAND.toml found in skill directory');
            process.exit(1);
          }

          // Simple TOML parsing for name and description
          const nameMatch = handToml.match(/name\s*=\s*"([^"]+)"/);
          const descMatch = handToml.match(/description\s*=\s*"([^"]+)"/);
          const skillName = nameMatch?.[1] ?? path.basename(resolvedDir);
          const description = descMatch?.[1] ?? '';

          // Use marketplace publisher
          const { preparePublish } = await import('@clawgear/marketplace');
          const result = preparePublish({
            manifest: {
              name: skillName,
              version: '0.1.0',
              description,
              author: 'local',
              license: 'MIT',
              tags: [],
              capabilities: [],
            },
            files: new Map(Object.entries(files)),
            privateKey: opts.key,
            publicKey: opts.pubkey,
          });

          if (!result.success) {
            console.error(`Publish failed: ${result.error}`);
            if (result.scanResult.issues.length > 0) {
              console.error('\nSecurity issues:');
              for (const issue of result.scanResult.issues) {
                console.error(
                  `  [${issue.severity}] ${issue.file}:${issue.line} — ${issue.message}`,
                );
              }
            }
            process.exit(1);
          }

          // Send to API
          const res = await fetch(`${opts.url}/api/companies/${opts.company}/marketplace/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              manifest: result.manifest,
              signature: result.signature,
              publisherKey: opts.pubkey,
              packageData: result.packageData,
            }),
          });

          if (!res.ok) {
            const body = (await res.json()) as { error: string };
            console.error(`API publish failed: ${body.error}`);
            process.exit(1);
          }

          console.log(`Published ${skillName}@0.1.0`);
          console.log(`  Checksum: ${result.manifest!.checksum}`);
          console.log(`  Security scan: ${result.scanResult.issues.length} issues (0 critical)`);
        } catch (err) {
          console.error(`Error: ${String(err)}`);
          process.exit(1);
        }
      },
    );

  // clawgear skill keygen
  skill
    .command('keygen')
    .description('Generate an Ed25519 key pair for skill signing')
    .action(async () => {
      const { generateKeyPair } = await import('@clawgear/marketplace');
      const keys = generateKeyPair();
      console.log('Ed25519 Key Pair Generated:\n');
      console.log(`Public Key:  ${keys.publicKey}`);
      console.log(`Private Key: ${keys.privateKey}`);
      console.log('\nStore the private key securely. You will need both keys for publishing.');
    });
}
