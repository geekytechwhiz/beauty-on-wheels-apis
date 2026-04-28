const { exec } = require('child_process');
const path = require('path');

// This file is /Applications/Utilities/projects/api-hub/script/script.js
// setup.sh is /Applications/Utilities/projects/api-hub/script/setup.sh
const scriptPath = path.join(__dirname, 'setup.sh');

exec(`bash "${scriptPath}"`, (error, stdout, stderr) => {
  if (error) {
    console.error('Script failed:', error);
    console.error(stderr);
    return;
  }
  console.log('Script output:', stdout);
});