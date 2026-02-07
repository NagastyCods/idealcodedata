import { env } from 'process';

async function main() {
  if (!env.MONGODB_URI) {
    console.log('MONGODB_URI not set — skipping bundles import during build.');
    return;
  }

  console.log('MONGODB_URI found — running bundles import...');

  try {
    const { default: runImport } = await import('./import_bundles.mjs');
    // import_bundles.mjs runs itself when imported; if it exports nothing that's fine.
  } catch (err) {
    console.error('Bundles import failed during build:', err);
    // Do not fail the build — just warn.
  }
}

main();
