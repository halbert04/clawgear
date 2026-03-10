interface StatusOptions {
  url: string;
}

export async function statusCommand(options: StatusOptions) {
  const url = `${options.url}/api/health/detail`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    console.log('ClawGear Status');
    console.log('================');
    console.log(`  Status:     ${data.status}`);
    console.log(`  Version:    ${data.version}`);
    console.log(`  Uptime:     ${data.uptime}s`);
    console.log(`  Instance:   ${data.instanceId}`);
    console.log(
      `  Database:   ${data.database.connected ? 'connected' : 'disconnected'} (${data.database.latencyMs}ms)`,
    );
  } catch {
    console.error(`Cannot reach ClawGear at ${options.url}`);
    console.error('Is the server running? Try: clawgear start');
    process.exit(1);
  }
}
