#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Add Controller Operation
 *
 * Usage:
 *
 * node tools/scripts/add-controller-operation.js \
 * identity \
 * Authentication \
 * Register
 *
 * ------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const SERVICE = process.argv[2];
const RESOURCE = process.argv[3];
const OPERATION = process.argv[4];

if (!SERVICE || !RESOURCE || !OPERATION) {

    console.error("");
    console.error("Usage:");
    console.error("node tools/scripts/add-controller-operation.js identity Authentication Register");
    process.exit(1);

}

const ROOT = process.cwd();

const FILE = path.join(

    ROOT,

    "apps",

    `${SERVICE}-service`,

    "src",

    "controllers",

    `${toKebabCase(RESOURCE)}.controller.ts"

);

if (!fs.existsSync(FILE)) {

    console.error("");

    console.error("Controller not found.");

    process.exit(1);

}

let source = fs.readFileSync(FILE, "utf8");

if (source.includes(`handle${OPERATION}(`)) {

    console.log("");

    console.log("Operation already exists.");

    process.exit(0);

}

/**
 * Add Service Import
 */

const serviceImport = `${lowerFirst(OPERATION)}`;

if (!source.includes(serviceImport)) {

    // no-op
    // service already injected

}

/**
 * Find last }
 */

const index = source.lastIndexOf("}");

const method = `

    async handle${OPERATION}(
        request: LambdaRequest
    ) {

        return this.service.${lowerFirst(OPERATION)}(
            request.body
        );

    }

`;

source =

    source.substring(0, index)

    +

    method

    +

    source.substring(index);

fs.writeFileSync(

    FILE,

    source

);

console.log("");

console.log("✓ Added");

console.log(`handle${OPERATION}`);

console.log("");

function lowerFirst(value) {

    return value.charAt(0).toLowerCase()

        + value.slice(1);

}

function toKebabCase(value) {

    return value

        .replace(/([a-z])([A-Z])/g, "$1-$2")

        .replace(/\s+/g, "-")

        .toLowerCase();

}