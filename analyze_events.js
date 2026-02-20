const fs = require('fs');
const path = require('path');

const workspacesDir = '.home/workspaces';
if (!fs.existsSync(workspacesDir)) {
  console.log('No workspaces found');
  process.exit(0);
}

const workspaces = fs.readdirSync(workspacesDir).filter((f) => !f.startsWith('.'));
for (const ws of workspaces) {
  const eventsFile = path.join(workspacesDir, ws, 'events', 'events.jsonl');
  if (!fs.existsSync(eventsFile)) continue;

  const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
  let runStart = 0;
  let runEnd = 0;
  let hasRecovery = false;

  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'run:start') runStart++;
      if (evt.type === 'run:done' || evt.type === 'run:error' || evt.type === 'run:interrupted') runEnd++;
      if (evt.type === 'hitl:required' || evt.type === 'run:resumed') {
        // checking for any resume events
      }
      if (evt.content && evt.content.includes('restart-recovery')) hasRecovery = true;
      if (evt.data && evt.data.reason === 'restart-recovery') hasRecovery = true;

      // Or look for specific events indicating wake
    } catch (e) {}
  }

  if (runStart > runEnd) {
    console.log(
      `[Unfinished] Workspace ${ws} has ${runStart} starts and ${runEnd} ends. Received recovery event? ${hasRecovery}`
    );
  } else {
    // console.log(`[Finished] Workspace ${ws}`);
  }
}
