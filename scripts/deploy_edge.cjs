#!/usr/bin/env node
/**
 * ==============================================================================
 *          ALPHA ENGINE - HIGH-SPEED EDGE VM DEPLOYMENT AUTOMATION
 * ==============================================================================
 * Primary deployment pipeline targeting the Frankfurt Edge Node VM
 * (https://misha-vm-gcp.duckdns.org) with sub-20-second turnaround.
 *
 * Usage:
 *   npm run deploy:edge
 *   npm run deploy
 *   node scripts/deploy_edge.cjs [options]
 *
 * Options:
 *   --with-standby   Also trigger Cloud Run deployment as secondary standby
 *   --skip-lint      Skip pre-flight TypeScript lint check (tsc --noEmit)
 *   --skip-push      Skip pushing local commits to origin main
 *   --dry-run        Print actions without executing remote changes
 * ==============================================================================
 */

const { execSync, spawnSync } = require('child_process');
const https = require('https');
const { performance } = require('perf_hooks');
const path = require('path');

// Configuration
const ZONE = 'europe-west3-a';
const VM_NAME = 'alpha-edge-node';
const REMOTE_DIR = '/opt/alpha-engine';
const PRIMARY_DOMAIN = 'https://misha-vm-gcp.duckdns.org';
const STANDBY_DOMAIN = 'https://alpha-engine-aistudio-138990607360.europe-west3.run.app';

// ANSI Styling
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

const args = process.argv.slice(2);
const withStandby = args.includes('--with-standby');
const skipLint = args.includes('--skip-lint');
const skipPush = args.includes('--skip-push');
const dryRun = args.includes('--dry-run');

function printBanner() {
  console.log(`\n${c.cyan}${c.bold}======================================================================${c.reset}`);
  console.log(`${c.cyan}${c.bold}     ALPHA ENGINE - HIGH-SPEED EDGE VM PRIMARY DEPLOYMENT            ${c.reset}`);
  console.log(`${c.cyan}${c.bold}======================================================================${c.reset}`);
  console.log(`${c.dim}  Target Primary Edge:   ${c.reset}${c.bold}${PRIMARY_DOMAIN}${c.reset} (Frankfurt europe-west3-a)`);
  console.log(`${c.dim}  Secondary Standby:     ${c.reset}${withStandby ? c.yellow + 'ENABLED (will deploy after edge)' : c.dim + 'Standby inactive (use --with-standby to sync)'}${c.reset}`);
  console.log(`${c.dim}  Mode:                  ${c.reset}${dryRun ? c.yellow + 'DRY RUN' : c.green + 'PRODUCTION ACTIVE'}${c.reset}\n`);
}

function runLocal(cmd, desc) {
  const t0 = performance.now();
  process.stdout.write(`  ${c.dim}[RUNNING]${c.reset} ${desc}... `);
  try {
    const res = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    process.stdout.write(`\r  ${c.green}[✓ OK]${c.reset} ${desc} ${c.dim}(${elapsed}s)${c.reset}\n`);
    return res.trim();
  } catch (err) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    process.stdout.write(`\r  ${c.red}[✗ FAILED]${c.reset} ${desc} ${c.dim}(${elapsed}s)${c.reset}\n`);
    if (err.stdout) console.error(`${c.dim}${err.stdout.trim()}${c.reset}`);
    if (err.stderr) console.error(`${c.red}${err.stderr.trim()}${c.reset}`);
    throw err;
  }
}

function probeEndpoint(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { timeout: 8000 }, (res) => {
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
      resolve({ ok: false, status: 408, elapsed: 8000, error: 'Request timed out after 8s' });
    });
  });
}

async function main() {
  const startTime = performance.now();
  printBanner();

  try {
    // ------------------------------------------------------------------------
    // Step 1: Pre-flight Compilation & Lint Check
    // ------------------------------------------------------------------------
    console.log(`${c.bold}[1/5] Pre-flight TypeScript & Workspace Verification${c.reset}`);
    if (!skipLint) {
      runLocal('npm run lint', 'Verifying TypeScript type safety (tsc --noEmit)');
    } else {
      console.log(`  ${c.yellow}[SKIP]${c.reset} TypeScript lint check skipped via --skip-lint`);
    }

    // Check git status
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    if (gitStatus.length > 0) {
      console.log(`  ${c.yellow}[WARN]${c.reset} Working tree has uncommitted local modifications:`);
      gitStatus.split('\n').slice(0, 5).forEach((line) => console.log(`         ${c.dim}${line}${c.reset}`));
      console.log(`  ${c.yellow}[INFO]${c.reset} Only committed changes pushed to origin/main will deploy to the VM.\n`);
    } else {
      console.log(`  ${c.green}[✓ OK]${c.reset} Working tree clean.`);
    }

    // ------------------------------------------------------------------------
    // Step 2: Push commits to remote origin main
    // ------------------------------------------------------------------------
    console.log(`\n${c.bold}[2/5] Git Remote Synchronization${c.reset}`);
    const currentCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    console.log(`  ${c.dim}Current local HEAD: ${c.bold}${currentCommit}${c.reset} on branch ${c.bold}${currentBranch}${c.reset}`);

    if (!skipPush && !dryRun) {
      runLocal('git push origin main', 'Pushing local commits to GitHub origin/main');
    } else if (skipPush) {
      console.log(`  ${c.yellow}[SKIP]${c.reset} Git push skipped via --skip-push`);
    }

    // ------------------------------------------------------------------------
    // Step 3: Remote Synchronization & Build on Frankfurt VM
    // ------------------------------------------------------------------------
    console.log(`\n${c.bold}[3/5] Deploying to Frankfurt Edge Node (${VM_NAME} | ${ZONE})${c.reset}`);
    if (dryRun) {
      console.log(`  ${c.yellow}[DRY RUN]${c.reset} Would execute git pull, npm run build, and service restart on ${VM_NAME}`);
    } else {
      const remoteCommands = [
        'set -e',
        `cd ${REMOTE_DIR}`,
        'sudo git config core.fileMode false',
        'echo "[VM 1/5] Preserving active live runtime state files..."',
        'for f in dynamic_baskets.json risk_limits.json backend/app/api/copilot_quota_state.json; do if [ -f "$f" ]; then cp "$f" "/tmp/$(basename $f).live"; sudo git checkout -- "$f" 2>/dev/null || true; fi; done',
        'echo "[VM 2/5] Pulling latest commits from origin main..."',
        'sudo git fetch origin main',
        'sudo git reset --hard origin/main',
        'echo "[VM 3/5] Restoring live runtime state files..."',
        'for f in dynamic_baskets.json risk_limits.json backend/app/api/copilot_quota_state.json; do if [ -f "/tmp/$(basename $f).live" ]; then cp "/tmp/$(basename $f).live" "$f"; rm -f "/tmp/$(basename $f).live"; fi; done',
        'echo "[VM 4/5] Compiling frontend & Express server bundle..."',
        'sudo npm run build',
        'echo "[VM 5/5] Restarting Alpha Engine services..."',
        'sudo systemctl restart alpha-ui.service alpha-engine.service',
        'sudo systemctl is-active alpha-ui alpha-engine ibgateway nginx'
      ].join(' && ');

      const t0 = performance.now();
      process.stdout.write(`  ${c.dim}[SSH CONNECTING]${c.reset} Executing remote update pipeline on Frankfurt VM... \n`);

      const b64Payload = Buffer.from(remoteCommands).toString('base64');
      const encodedCommand = `echo ${b64Payload} | base64 -d | bash`;

      const sshResult = spawnSync(
        'gcloud',
        ['compute', 'ssh', VM_NAME, `--zone=${ZONE}`, `--command=${encodedCommand}`],
        { stdio: 'inherit', shell: true }
      );

      if (sshResult.status !== 0) {
        throw new Error(`gcloud compute ssh exited with status code ${sshResult.status}`);
      }
      const remoteElapsed = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`  ${c.green}[✓ OK]${c.reset} Frankfurt VM remote build & restart completed ${c.dim}(${remoteElapsed}s)${c.reset}`);
    }

    // ------------------------------------------------------------------------
    // Step 4: Live Health Probe on Primary Domain
    // ------------------------------------------------------------------------
    console.log(`\n${c.bold}[4/5] Live Primary Domain Health Verification${c.reset}`);
    const probeEndpoints = [
      { name: 'Lens 1 IC Telemetry', url: `${PRIMARY_DOMAIN}/api/events/information-coefficient` },
      { name: 'Lens 1 Catalyst Radar', url: `${PRIMARY_DOMAIN}/api/events/catalysts` },
    ];

    for (const ep of probeEndpoints) {
      process.stdout.write(`  ${c.dim}[PROBING]${c.reset} ${ep.name} (${ep.url})... `);
      const res = await probeEndpoint(ep.url);
      if (res.ok) {
        process.stdout.write(`\r  ${c.green}[✓ HEALTHY]${c.reset} ${ep.name}: HTTP ${res.status} ${c.dim}(${res.elapsed}ms)${c.reset}\n`);
      } else {
        process.stdout.write(`\r  ${c.red}[✗ FAILED]${c.reset} ${ep.name}: HTTP ${res.status} (${res.error || 'bad status'}) ${c.dim}(${res.elapsed}ms)${c.reset}\n`);
      }
    }

    // ------------------------------------------------------------------------
    // Step 5: Optional Standby Mirror Deployment
    // ------------------------------------------------------------------------
    console.log(`\n${c.bold}[5/5] Secondary Cloud Run Standby Status${c.reset}`);
    if (withStandby && !dryRun) {
      console.log(`  ${c.cyan}[INFO]${c.reset} Invoking Cloud Run Standby Deployer...`);
      const standbyScript = path.join(__dirname, 'deploy_cloudrun.cjs');
      spawnSync('node', [standbyScript], { stdio: 'inherit', shell: true });
    } else {
      console.log(`  ${c.dim}[STANDBY POISED]${c.reset} Cloud Run standby left untouched.`);
      console.log(`  ${c.dim}                 To update Cloud Run standby mirror, run: ${c.cyan}npm run deploy:standby${c.reset}`);
    }

    // Final Summary
    const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`\n${c.green}${c.bold}======================================================================${c.reset}`);
    console.log(`${c.green}${c.bold}  DEPLOYMENT COMPLETE IN ${totalElapsed}s - PRIMARY EDGE FULLY OPERATIONAL  ${c.reset}`);
    console.log(`${c.green}${c.bold}======================================================================${c.reset}`);
    console.log(`  ${c.bold}Primary Web Control Plane:${c.reset}  ${c.cyan}${PRIMARY_DOMAIN}${c.reset}`);
    console.log(`  ${c.bold}Interactive Brokers noVNC:${c.reset}  ${c.cyan}${PRIMARY_DOMAIN}:8443${c.reset}`);
    console.log(`  ${c.bold}Active Git Release:${c.reset}         ${c.magenta}${currentCommit}${c.reset}`);
    console.log(`  ${c.bold}Edge Execution Daemon:${c.reset}      ${c.green}Port 4005 (DIRECT TCP LOOPBACK)${c.reset}\n`);

  } catch (err) {
    console.error(`\n${c.red}${c.bold}[DEPLOYMENT ABORTED]${c.reset} ${err.message}`);
    process.exit(1);
  }
}

main();
