#!/usr/bin/env node
/**
 * ==============================================================================
 *       ALPHA ENGINE - CLOUD RUN STANDBY CONTROL PLANE DEPLOYER
 * ==============================================================================
 * Deploys the web control plane container to Google Cloud Run as a secondary
 * standby mirror (https://alpha-engine-aistudio-138990607360.europe-west3.run.app).
 *
 * Usage:
 *   node scripts/deploy_cloudrun.js [options]
 *   npm run deploy:standby
 *   npm run deploy:cloudrun
 * ==============================================================================
 */

const { spawnSync } = require('child_process');
const https = require('https');
const { performance } = require('perf_hooks');

const REGION = 'europe-west3';
const SERVICE_NAME = 'alpha-engine-aistudio';
const STANDBY_DOMAIN = 'https://alpha-engine-aistudio-138990607360.europe-west3.run.app';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function printBanner() {
  console.log(`\n${c.magenta}${c.bold}======================================================================${c.reset}`);
  console.log(`${c.magenta}${c.bold}     ALPHA ENGINE - CLOUD RUN STANDBY MIRROR DEPLOYMENT               ${c.reset}`);
  console.log(`${c.magenta}${c.bold}======================================================================${c.reset}`);
  console.log(`${c.dim}  Service:    ${c.reset}${c.bold}${SERVICE_NAME}${c.reset}`);
  console.log(`${c.dim}  Region:     ${c.reset}${c.bold}${REGION}${c.reset}`);
  console.log(`${c.dim}  URL:        ${c.reset}${c.cyan}${STANDBY_DOMAIN}${c.reset}\n`);
}

function probeEndpoint(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = (performance.now() - t0).toFixed(0);
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          elapsed,
          body: parsed || data.substring(0, 100)
        });
      });
    });
    req.on('error', (err) => {
      const elapsed = (performance.now() - t0).toFixed(0);
      resolve({ ok: false, status: 0, elapsed, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 408, elapsed: 15000, error: 'Request timed out after 15s' });
    });
  });
}

async function main() {
  const startTime = performance.now();
  printBanner();

  console.log(`${c.bold}[1/2] Building Container & Deploying Revision via Google Cloud Build...${c.reset}`);
  console.log(`  ${c.dim}[INFO] This step compiles the Docker container and rolls out the revision (${c.yellow}~3-4 minutes${c.dim})...${c.reset}\n`);

  const deployResult = spawnSync(
    'gcloud',
    [
      'run', 'deploy', SERVICE_NAME,
      '--source', '.',
      '--region', REGION,
      '--allow-unauthenticated'
    ],
    { stdio: 'inherit', shell: true }
  );

  if (deployResult.status !== 0) {
    console.error(`\n${c.red}${c.bold}[STANDBY DEPLOY FAILED]${c.reset} gcloud run deploy exited with status code ${deployResult.status}`);
    process.exit(1);
  }

  console.log(`\n${c.bold}[2/2] Probing Cloud Run Standby Endpoint Health...${c.reset}`);
  const probeEndpoints = [
    { name: 'Lens 1 IC Telemetry', url: `${STANDBY_DOMAIN}/api/events/information-coefficient` },
    { name: 'Lens 1 Catalyst Radar', url: `${STANDBY_DOMAIN}/api/events/catalysts` },
  ];

  for (const ep of probeEndpoints) {
    process.stdout.write(`  ${c.dim}[PROBING]${c.reset} ${ep.name}... `);
    const res = await probeEndpoint(ep.url);
    if (res.ok) {
      process.stdout.write(`\r  ${c.green}[✓ HEALTHY]${c.reset} ${ep.name}: HTTP ${res.status} ${c.dim}(${res.elapsed}ms)${c.reset}\n`);
    } else {
      process.stdout.write(`\r  ${c.red}[✗ FAILED]${c.reset} ${ep.name}: HTTP ${res.status} (${res.error || 'bad status'}) ${c.dim}(${res.elapsed}ms)${c.reset}\n`);
    }
  }

  const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${c.green}${c.bold}======================================================================${c.reset}`);
  console.log(`${c.green}${c.bold}  CLOUD RUN STANDBY MIRROR UPDATED IN ${totalElapsed}s                ${c.reset}`);
  console.log(`${c.green}${c.bold}======================================================================${c.reset}`);
  console.log(`  ${c.bold}Standby Endpoint:${c.reset} ${c.cyan}${STANDBY_DOMAIN}${c.reset}\n`);
}

main();
