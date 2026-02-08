import { env } from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🔨 Vercel build starting...');
  
  if (!env.MONGODB_URI) {
    console.warn('⚠️  MONGODB_URI not set — bundles import will be skipped.');
    return;
  }

  console.log('✅ MONGODB_URI found — importing bundles...');

  try {
    execSync('node scripts/import_bundles.mjs', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit', // Show full output
    });
    console.log('✅ Build completed successfully');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exitCode = 1;
  }
}

main();
