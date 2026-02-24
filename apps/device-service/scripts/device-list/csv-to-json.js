#!/usr/bin/env node
/**
 * Convert root-level device list CSV to device-list.json (DynamoDB item array).
 * Usage: node csv-to-json.js [--input path/to/results-7.csv] [--output data/device-list.json]
 * Default: reads from stdin if no --input, writes to data/device-list.json (relative to script dir).
 */

const fs = require('fs');
const path = require('path');
const { parseCsvRow, rowToItem, CSV_HEADERS } = require('./parse-csv-row.js');

const scriptDir = __dirname;
const defaultOutput = path.join(scriptDir, 'data', 'device-list.json');

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = defaultOutput;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) outputPath = args[++i];
  }
  return { inputPath, outputPath };
}

async function main() {
  const { inputPath, outputPath } = parseArgs();
  let csvText;
  if (inputPath) {
    csvText = fs.readFileSync(path.resolve(inputPath), 'utf8');
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    csvText = Buffer.concat(chunks).toString('utf8');
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('Need at least header + one row');
    process.exit(1);
  }
  const header = parseCsvRow(lines[0].replace(/^\uFEFF/, ''));
  const first = (header[0] || '').trim();
  const second = (header[1] || '').trim();
  if (first !== 'pk' || second !== 'sk') {
    console.error('Expected CSV header to start with pk, sk. Got:', JSON.stringify(header.slice(0, 3)));
    process.exit(1);
  }

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const item = rowToItem(values);
    if (item) items.push(item);
  }

  const outDir = path.dirname(outputPath);
  if (outDir && outDir !== '.') fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(items, null, 2), 'utf8');
  console.log(`Wrote ${items.length} devices to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
