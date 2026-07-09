const fs = require('fs');

function replaceInFile(file, replacements) {
    let content = fs.readFileSync(file, 'utf8');
    for (const [from, to] of replacements) {
        content = content.replace(new RegExp(from, 'g'), to);
    }
    fs.writeFileSync(file, content);
}

const base = 'libs/authentication-core/src/lib';

replaceInFile(`${base}/builder/identity-entity.builder.ts`, [
    ['../lib/constants/identity.constants', '../constants/identity.constants'],
    ['../models/persistence/identity-repository.types', '../persistence/identity-repository.types'],
    ['../models/persistence/identity-ddb.model', '../persistence/identity-ddb.model']
]);

replaceInFile(`${base}/builder/identity-key.builder.ts`, [
    ['../lib/constants/identity.constants', '../constants/identity.constants']
]);

replaceInFile(`${base}/services/AuthenticationService.ts`, [
    ['../repositories-v1/AuthenticationRepository', '../repositories/AuthenticationRepository'],
    ['../models/persistence/identity-ddb.model', '../persistence/identity-ddb.model'],
    ['../models/persistence/identity-repository.types', '../persistence/identity-repository.types']
]);

replaceInFile(`${base}/services/UserService.ts`, [
    ['../repositories-v1/UserRepository', '../repositories/UserRepository'],
    ['../models/persistence/identity-ddb.model', '../persistence/identity-ddb.model'],
    ['../models/persistence/identity-repository.types', '../persistence/identity-repository.types']
]);

console.log('Done');
