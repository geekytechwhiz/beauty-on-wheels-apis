const { exec } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'setup.sh');

export const setupScript = async () => {
  try {
    exec(`bash "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Script failed:', error);
        console.error(stderr);
        return;
      }
      // console.log('Script output:', stdout);
    });
  } catch (error) {
    console.error('Script failed:', error);
  }
};
