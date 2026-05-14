const { execSync } = require('child_process');

const files = process.argv.slice(2);

if (!files.length) {
  process.exit(0);
}

try {
  const commands = files.map((file) => `eslint --fix "${file}"`);

  execSync(commands.join(' && '), {
    stdio: 'inherit',
  });
} catch (e) {
  process.exit(1);
}