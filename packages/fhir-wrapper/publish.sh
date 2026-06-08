export NPM_TOKEN="$(grep '^NPM_TOKEN=' ../../.env | cut -d= -f2- | tr -d '\r\n\"')"
cd packages/fhir-wrapper
npm publish --access public --userconfig=../../.npmrc
