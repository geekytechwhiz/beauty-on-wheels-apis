// scripts/rule-checker.js

const fs = require('fs');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// ✅ Replace chalk with ANSI helpers
const red = (msg) => `\x1b[31m${msg}\x1b[0m`;
const yellow = (msg) => `\x1b[33m${msg}\x1b[0m`;
const blue = (msg) => `\x1b[34m${msg}\x1b[0m`;
const green = (msg) => `\x1b[32m${msg}\x1b[0m`;

let hasError = false;

// ---------- INPUT ----------
const projectsArg = process.argv[2];

if (!projectsArg) {
  console.error(red("❌ No projects passed to rule checker"));
  process.exit(1);
}

const projects = projectsArg.split(',').map(p => p.trim());

// console.log(blue(`🔍 Running checks for projects: ${projects.join(', ')}`));

// ---------- CONFIG ----------
const SECRET_NAME_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i
];

const SAFE_SECRET_IDENTIFIER_PATTERNS = [
  /authHeader/i,
  /authorization/i,
  /bearer/i,
  /jwt/i,
  /decoded/i,
  /authorizer/i
];

// ---------- UTIL ----------
function parseFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  return parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });
}

function fail(ruleId, message, file) {
  // console.log(red(`❌ [${ruleId}] ${message} → ${file}`));
  hasError = true;
}

function warn(ruleId, message, file) {
  // console.log(yellow(`⚠️ [${ruleId}] ${message} → ${file}`));
}

function matchesAnyPattern(value, patterns) {
  return patterns.some(pattern => pattern.test(value));
}

function getStaticStringValue(node) {
  if (!node) return null;

  if (node.type === 'StringLiteral') {
    return node.value;
  }

  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(quasi => quasi.value.cooked ?? '').join('');
  }

  return null;
}

function getKeyName(node) {
  if (!node) return null;

  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;

  return null;
}

function isSafeSecretContext(name, value) {
  const candidate = `${name} ${value}`;
  return matchesAnyPattern(candidate, SAFE_SECRET_IDENTIFIER_PATTERNS);
}

// Get files from apps + libs
function getFiles(pattern) {
  let files = [];

  projects.forEach(project => {
    let basePath;

    // ✅ If already includes apps/ or libs/, use directly
    if (project.startsWith('apps/') || project.startsWith('libs/')) {
      basePath = `${project}/src`;
    } else {
      // fallback (just in case)
      const appPath = `apps/${project}/src`;
      const libPath = `libs/${project}/src`;

      if (fs.existsSync(appPath)) {
        basePath = appPath;
      } else if (fs.existsSync(libPath)) {
        basePath = libPath;
      }
    }

    if (basePath && fs.existsSync(basePath)) {
      files = files.concat(glob.sync(`${basePath}/${pattern}`));
    }
  });

  return files;
}

// ---------- RULES ----------

// ARCH-001: No DB/repository access in controller
function checkControllerDBAccess() {
  const files = getFiles('**/controller.ts');

  files.forEach(file => {
    const ast = parseFile(file);

    traverse(ast, {
      MemberExpression(path) {
        const name = path.toString();

        if (
          name.includes('repository') ||
          name.includes('db') ||
          name.includes('model')
        ) {
          fail(
            'ARCH-001',
            'Controller should not access DB/repository directly',
            file
          );
        }
      }
    });
  });
}

// ARCH-002: No business logic in controller
function checkControllerBusinessLogic() {
  const files = getFiles('**/controller.ts');

  files.forEach(file => {
    const ast = parseFile(file);

    traverse(ast, {
      IfStatement() {
        fail('ARCH-002', 'Business logic (if) in controller', file);
      },
      ForStatement() {
        fail('ARCH-002', 'Loop detected in controller', file);
      }
    });
  });
}

// VAL-001: Validation required in service
function checkValidationUsage() {
  const files = getFiles('**/service.ts');

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');

    if (!content.includes('validate')) {
      warn('VAL-001', 'Validation not found in service', file);
    }
  });
}

// SEC-001: No hardcoded secrets
function checkSecrets() {
  const files = getFiles('**/*.ts');

  files.forEach(file => {
    const ast = parseFile(file);

    traverse(ast, {
      VariableDeclarator(path) {
        if (path.node.id.type !== 'Identifier') return;

        const name = path.node.id.name;
        const value = getStaticStringValue(path.node.init);

        if (!value) return;
        if (!matchesAnyPattern(name, SECRET_NAME_PATTERNS)) return;
        if (isSafeSecretContext(name, value)) return;

        fail('SEC-001', `Possible hardcoded secret in variable "${name}"`, file);
      },
      ObjectProperty(path) {
        const name = getKeyName(path.node.key);
        const value = getStaticStringValue(path.node.value);

        if (!name || !value) return;
        if (!matchesAnyPattern(name, SECRET_NAME_PATTERNS)) return;
        if (isSafeSecretContext(name, value)) return;

        fail('SEC-001', `Possible hardcoded secret in property "${name}"`, file);
      }
    });
  });
}

// TEST-001: Test files must exist
function checkTests() {
  const files = [
    ...getFiles('**/*.test.ts'),
    ...getFiles('**/*.spec.ts')
  ];

  if (files.length === 0) {
    fail('TEST-001', 'No test files found', 'GLOBAL');
  } else {
    // console.log(green(`✅ Found ${files.length} test files`));
  }
}

// ERR-001: Error handling check
function checkErrorHandling() {
  const files = getFiles('**/service.ts');

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');

    if (!content.includes('try') || !content.includes('catch')) {
      warn('ERR-001', 'Missing try-catch in service', file);
    }
  });
}

// LOG-001: Logging check
function checkLogging() {
  const files = getFiles('**/*.ts');

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');

    if (!content.includes('logger') && !content.includes('console')) {
      warn('LOG-001', 'No logging found', file);
    }
  });
}

// ---------- RUN ----------
function run() {
  // console.log(blue('\n🔍 Running Rule Checker...\n'));

  checkControllerDBAccess();
  checkControllerBusinessLogic();
  checkValidationUsage();
  checkSecrets();
  checkTests();
  checkErrorHandling();
  checkLogging();

  // console.log('\n------------------------');

  if (hasError) {
    // console.log(red('🚫 RULE CHECK FAILED'));
    process.exit(1);
  } else {
    // console.log(green('✅ ALL RULES PASSED'));
  }
}

run();