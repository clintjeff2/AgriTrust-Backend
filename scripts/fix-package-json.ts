import fs from 'fs';
import path from 'path';

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

packageJson.scripts = packageJson.scripts || {};
packageJson.scripts['test:contract'] = 'npx ts-node scripts/run-openapi-contract-tests.ts';

packageJson.dependencies = packageJson.dependencies || {};
packageJson.dependencies['@apidevtools/json-schema-ref-parser'] = '^9.0.9';
packageJson.dependencies['ajv'] = '^8.12.0';
packageJson.dependencies['ajv-formats'] = '^2.1.1';
packageJson.dependencies['yaml'] = '^2.3.1';

packageJson.devDependencies = packageJson.devDependencies || {};
packageJson.devDependencies['@types/supertest'] = '^2.0.12';
packageJson.devDependencies['supertest'] = '^6.4.0';
packageJson.devDependencies['dredd'] = '^16.0.0';
packageJson.devDependencies['openapi-types'] = '^11.0.0';

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log('package.json has been updated.');
