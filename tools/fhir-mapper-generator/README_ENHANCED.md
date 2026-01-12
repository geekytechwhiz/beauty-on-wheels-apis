# FHIR Mapper Generator - Enhanced Edition

## 🎯 Overview

Production-ready code generator for FHIR gateway that generates complete, maintainable code including:
- ✅ Service clients with proper endpoint handling
- ✅ Lambda handlers with full error handling
- ✅ FHIR adapters with field mappings
- ✅ **DTO types** (NEW)
- ✅ **FHIR resource models** (NEW)
- ✅ **Helper utility methods** (NEW)
- ✅ **Automatic index.ts updates** (NEW)
- ✅ **Intelligent file merging** (NEW)

## 🚀 Quick Start

### Generate Complete Code for an Endpoint

```bash
# From workspace root
node tools/fhir-mapper-generator/dist/index.js generate \
  -c tools/fhir-mapper-generator/user-service-configs/getUser-mapping.yaml
```

### Generate All Endpoints

```bash
# Build the generator first
cd tools/fhir-mapper-generator
pnpm build
cd ../..

# Generate all
for config in tools/fhir-mapper-generator/user-service-configs/*-mapping.yaml; do
  node tools/fhir-mapper-generator/dist/index.js generate -c "$config"
done
```

## 📋 What Gets Generated

For each endpoint configuration, the generator creates:

### 1. Service Client
**Location**: `apps/fhir-gateway/src/services/{service-name}.client.ts`

- HTTP client with axios
- Proper endpoint URL construction (handles `{id}` → `${id}`)
- Authentication handling
- Error handling with custom error classes
- Correlation ID support
- Logging integration

### 2. Handler
**Location**: `apps/fhir-gateway/src/handlers/{resource-name}.ts`

- AWS Lambda handler
- Request validation
- Authentication validation
- FHIR response formatting
- Error handling with problem details
- Logging and correlation ID tracking

### 3. Adapter
**Location**: `libs/fhir/src/adapters/{category}/{resource-name}.adapter.ts`

- DTO to FHIR resource transformation
- Field mappings from config
- Utility function usage
- Proper type handling

### 4. DTO Type ⭐ NEW
**Location**: `libs/fhir/src/types/internal.ts` (merged)

- TypeScript interface definitions
- Array type support (e.g., `ListUserOrganizationsDTO`)
- Field inference from mappings
- Smart merging (doesn't overwrite existing DTOs)

### 5. FHIR Model ⭐ NEW
**Location**: `libs/fhir/src/models/r4/{resource-name}.ts`

- FHIR R4 compliant resource interface
- Proper imports from common types
- Field definitions based on mappings or FHIR spec

### 6. Helper Methods ⭐ NEW
**Location**: `libs/fhir/src/utils/{category}.ts` (merged)

- Resource-specific helper functions
- Example: `createUserReference()`, `createListUserOrganizationsReference()`
- Follows existing patterns
- Smart merging (doesn't overwrite existing helpers)

### 7. Index Exports ⭐ NEW
**Location**: `libs/fhir/src/index.ts` (auto-updated)

- Automatic model exports
- Automatic adapter exports
- Maintains section organization

## 🔧 Configuration

### Basic Config Structure

```yaml
service:
  name: user-service
  baseUrl: ${env:USER_SERVICE_SERVICE_URL, 'http://localhost:3000'}
  apiEndpoint: /user/{id}
  method: GET
  authRequired: true
  responseType: UserDTO

fhirResource:
  resourceType: User
  category: identity
  path: user

mappings:
  - source: userID
    target: id
    transformation: dto.userID
    description: Resource ID mapping

generation:
  generateFiles:
    - service-client
    - adapter
    - handler
    - dto-type        # Generate DTO types
    - fhir-model      # Generate FHIR models
    - helper-methods  # Generate helper methods
  options:
    addComments: true
    addJSDoc: true
    includeValidation: true
    formatCode: true
```

## 🔄 Update Strategy

### Adding New Endpoints
1. Create new config file
2. Run generator
3. All files automatically created/updated

### Updating Existing Endpoints
1. Update config file with new mappings
2. Run generator
3. Files intelligently merged:
   - **DTOs**: Appended if new, skipped if exists
   - **Models**: Can overwrite (typically safe)
   - **Helpers**: Appended if new, skipped if exists
   - **Service Clients**: Currently overwrites (merge strategy available)
   - **Adapters**: Currently overwrites (merge strategy available)
   - **Handlers**: Currently overwrites (typically safe)

### Contract Changes
When service contracts change:
- **New fields**: Add to mappings, regenerate
- **Removed fields**: Manually remove or regenerate carefully
- **Type changes**: Update mappings, regenerate

## 🏗️ Architecture

### Generator Classes

- **CodeGenerator**: Service clients, handlers, adapters
- **DTOGenerator**: DTO type generation
- **FhirModelGenerator**: FHIR model generation
- **HelperGenerator**: Helper method generation
- **FileMerger**: Intelligent file merging

### Templates

- `service-client.hbs`: Service client template
- `handler.hbs`: Lambda handler template
- `adapter.hbs`: Adapter template
- `dto-type.hbs`: DTO type template ⭐ NEW
- `fhir-model.hbs`: FHIR model template ⭐ NEW
- `helper-method.hbs`: Helper method template ⭐ NEW

## 📝 Best Practices

### 1. Configuration Management
- Keep config files in version control
- Document custom mappings
- Use descriptive field descriptions

### 2. Code Review
- Review generated code before committing
- Verify endpoint URLs are correct
- Check field mappings are accurate

### 3. Testing
- Test generated endpoints locally
- Verify FHIR resource structure
- Check error handling paths

### 4. Maintenance
- Regenerate when contracts change
- Keep configs in sync with service definitions
- Update mappings as needed

## 🐛 Troubleshooting

### Issue: "Template not found"
**Solution**: Ensure you're running from workspace root or specify template directory

### Issue: "DTO already exists"
**Solution**: This is expected - the generator skips existing DTOs. Remove manually if you want to regenerate.

### Issue: "Endpoint not working"
**Solution**: 
- Check `apiEndpoint` in config matches actual service endpoint
- Verify path parameters match: `{id}` vs `{userId}`
- Check HTTP method matches

### Issue: TypeScript errors
**Solution**:
- Ensure DTO types exist in `libs/fhir/src/types/internal.ts`
- Verify FHIR models exist in `libs/fhir/src/models/r4/`
- Check all imports are correct
- Run `npx nx run fhir-gateway:build` to see full errors

## 📚 Documentation

- **ARCHITECTURE_REVIEW.md**: Detailed architecture analysis
- **IMPLEMENTATION_SUMMARY.md**: Implementation details
- **README.md**: Original documentation

## ✅ Production Readiness

The generator now produces:
- ✅ Complete code (all components)
- ✅ Type-safe TypeScript
- ✅ Proper error handling
- ✅ Maintainable structure
- ✅ Smart file merging
- ✅ Automatic exports
- ✅ Production patterns

## 🎓 Examples

### Example: Generate getUser endpoint

```bash
node tools/fhir-mapper-generator/dist/index.js generate \
  -c tools/fhir-mapper-generator/user-service-configs/getUser-mapping.yaml
```

**Generates**:
- `apps/fhir-gateway/src/services/user-service.client.ts` (with `getUser` method)
- `apps/fhir-gateway/src/handlers/user.ts`
- `libs/fhir/src/adapters/identity/user.adapter.ts`
- DTO type in `libs/fhir/src/types/internal.ts`
- `libs/fhir/src/models/r4/user.ts`
- Helper method in `libs/fhir/src/utils/reference.ts`
- Updates `libs/fhir/src/index.ts`

### Example: Dry Run

```bash
node tools/fhir-mapper-generator/dist/index.js generate \
  -c tools/fhir-mapper-generator/user-service-configs/getUser-mapping.yaml \
  --dry-run
```

Preview generated code without writing files.

## 🔮 Future Enhancements

Potential future improvements:
- AST-based service client merging
- Contract change detection
- Migration tooling
- Enhanced validation
- Unit test generation

