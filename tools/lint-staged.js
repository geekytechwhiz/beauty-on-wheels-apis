const { execSync } = require('child_process');

const files = process.argv.slice(2);

if (!files.length) {
  process.exit(0);
}

try {
  const filesArgs = files.map((file) => `"${file}"`).join(' ');

  execSync(`npx eslint --fix ${filesArgs}`, {
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
