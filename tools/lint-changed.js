/* eslint-disable */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Helper to get all changed files in the workspace
function getChangedFiles() {
  const files = new Set();

  // 1. Get files from git status (covers staged, unstaged, untracked files)
  try {
    const statusOutput = execSync('git status --porcelain', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'] // ignore stderr
    });
    statusOutput.split('\n').forEach((line) => {
      if (line.length > 3) {
        let filePath = line.substring(3).trim();
        // Handle quoted paths (git status quotes paths with special characters)
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.substring(1, filePath.length - 1);
        }
        // Handle renamed files: "R  old -> new"
        if (line.startsWith('R') || line.startsWith('C')) {
          const parts = filePath.split(' -> ');
          if (parts.length > 1) {
            filePath = parts[1].trim();
          }
        }
        const absolutePath = path.resolve(filePath);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          files.add(filePath);
        }
      }
    });
  } catch (e) {
    // Ignore git errors
  }

  // 2. Get files from NX_BASE and NX_HEAD diff if available
  const base = process.env.NX_BASE;
  const head = process.env.NX_HEAD;
  if (base && head) {
    try {
      const diffOutput = execSync(`git diff --name-only "${base}"..."${head}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      diffOutput.split('\n').forEach((line) => {
        const filePath = line.trim();
        if (filePath) {
          const absolutePath = path.resolve(filePath);
          if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            files.add(filePath);
          }
        }
      });
    } catch (e) {
      // Ignore
    }
  }

  return Array.from(files);
}

// Resolve files to lint
let filesToLint = [];
const args = process.argv.slice(2);

if (args.length > 0) {
  filesToLint = args.filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
} else {
  filesToLint = getChangedFiles();
}

// Filter to only TS/JS files
const tsJsFiles = filesToLint.filter((file) => {
  const ext = path.extname(file);
  return ['.ts', '.tsx', '.js', '.jsx', '.cts', '.mts', '.cjs', '.mjs'].includes(ext) &&
         !file.includes('node_modules/') &&
         !file.includes('dist/');
});

if (tsJsFiles.length === 0) {
  console.log('✨ No modified TypeScript/JavaScript files to lint.');
  process.exit(0);
}

console.log(`🔍 Linting ${tsJsFiles.length} modified file(s)...`);

try {
  const filesArgs = tsJsFiles.map((file) => `"${file}"`).join(' ');
  execSync(`npx eslint --fix ${filesArgs}`, {
    stdio: 'inherit',
  });
  console.log('✅ Lint passed successfully.');
} catch (error) {
  console.error('❌ Lint failed.');
  process.exit(1);
}
