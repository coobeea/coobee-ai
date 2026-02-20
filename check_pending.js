const fs = require('fs');
const path = require('path');

const workspacesDir = '.home/workspaces';
if (!fs.existsSync(workspacesDir)) {
  console.log('No workspaces found');
  process.exit(0);
}

const workspaces = fs.readdirSync(workspacesDir).filter((f) => !f.startsWith('.'));
let found = 0;
for (const ws of workspaces) {
  const cpFile = path.join(workspacesDir, ws, 'checkpoint.json');
  if (fs.existsSync(cpFile)) {
    const cp = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
    console.log(`Found pending workspace ${ws}: status = ${cp.runStatus}`);

    const eventsFile = path.join(workspacesDir, ws, 'events', 'events.jsonl');
    if (fs.existsSync(eventsFile)) {
      const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
      const recoveries = lines.filter((l) => l.includes('restart-recovery'));
      console.log(`  Recovery events found in events.jsonl: ${recoveries.length}`);
      if (recoveries.length > 0) {
        console.log(`  Sample: ${recoveries[0]}`);
      }
    }
    found++;
  }
}
if (found === 0) console.log('No pending checkpoints found. All tasks are finished.');
