interface StartOptions {
  port: string;
}

export async function startCommand(options: StartOptions) {
  const port = Number(options.port);

  process.env.CLAWGEAR_PORT = String(port);

  console.log(`Starting ClawGear on port ${port}...`);

  // Dynamic import to pick up env vars
  await import('@clawgear/api');
}
