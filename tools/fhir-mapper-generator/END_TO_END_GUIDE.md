# End-to-End Guide: Generating FHIR Mapping for a Microservice

This guide walks you through generating complete FHIR mapping code for a microservice from start to finish.

## Prerequisites

- Node.js 18+ installed
- The tool is built (`pnpm build` completed)
- You have a microservice with a REST API endpoint that returns data
- You know which FHIR resource type you want to map to (e.g., Medication, Observation, etc.)

## Example: Medication Service

We'll use a **Medication Service** as our example throughout this guide.

---

## Step 1: Understand Your Microservice API

Before generating code, you need to know:

1. **Service Name**: `medication-service`
2. **API Endpoint**: `/medications/{id}` (GET request)
3. **Response Structure**: What fields does your API return?
4. **FHIR Resource**: `Medication` (FHIR R4)

### Sample API Response

```json
{
  "data": {
    "medicationId": "med-123",
    "code": "123456",
    "codeDisplay": "Aspirin 81mg",
    "status": "active",
    "form": "tablet",
    "strength": "81 mg",
    "manufacturer": {
      "id": "org-456",
      "name": "Pharma Corp"
    },
    "ingredients": [
      {
        "id": "sub-789",
        "name": "Acetylsalicylic acid",
        "strength": "81 mg"
      }
    ]
  }
}
```

---

## Step 2: Create Configuration File

### Option A: Generate from serverless.yml (Fastest - if you have serverless.yml)

If you already have a `serverless.yml` file with your API endpoints defined:

```bash
cd tools/fhir-mapper-generator
node dist/index.js from-serverless -s ../../apps/your-service/serverless.yml -f getResource -o ../../configs/resource-mapping.yaml
```

This will:
- Parse your serverless.yml
- Extract GET functions with path parameters
- Generate a configuration template with:
  - Service name from serverless.yml
  - API endpoint inferred from path
  - Query parameters from documentation
  - Basic field mappings

**Interactive mode:**
```bash
node dist/index.js from-serverless -s ../../apps/your-service/serverless.yml --interactive
```

### Option B: Use the Init Command

```bash
cd tools/fhir-mapper-generator
node dist/index.js init medication-service -o ../../configs/medication-mapping.yaml
```

This creates a template configuration file.

### Option C: Create Manually

Create `configs/medication-mapping.yaml`:

```yaml
service:
  name: "medication-service"
  baseUrl: "${env:MEDICATION_SERVICE_URL, 'http://localhost:3001'}"
  apiEndpoint: "/medications/{id}"
  method: "GET"
  authRequired: true
  responseType: "MedicationDTO"

fhirResource:
  resourceType: "Medication"
  category: "medication"  # Used for adapter folder: libs/fhir/src/adapters/medication/
  path: "medication"      # Used in FHIR endpoint: /fhir/medication/{id}

# Field mappings from your API response to FHIR resource
mappings:
  # Direct ID mapping
  - source: "medicationId"
    target: "id"
    transformation: "dto.medicationId"
  
  # Status mapping with custom transformation
  - source: "status"
    target: "status"
    transformation: "mapMedicationStatus(dto.status)"
    description: "Map status to FHIR medication status"
  
  # CodeableConcept for medication code
  - source: "code"
    target: "code"
    transformation: |
      createCodeableConcept(
        'http://www.nlm.nih.gov/research/umls/rxnorm',
        dto.code,
        dto.codeDisplay
      )
    utilityFunctions:
      - "createCodeableConcept"
    description: "Medication code using RxNorm"
  
  # Optional form mapping
  - source: "form"
    target: "form"
    transformation: |
      createCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm',
        dto.form?.toLowerCase().replace(/\s+/g, '-'),
        dto.form
      )
    optional: true
    condition: "dto.form"
    utilityFunctions:
      - "createCodeableConcept"
  
  # Manufacturer reference
  - source: "manufacturer"
    target: "manufacturer"
    transformation: |
      createReference('Organization', dto.manufacturer.id, dto.manufacturer.name)
    condition: "dto.manufacturer"
    utilityFunctions:
      - "createReference"
  
  # Ingredients array mapping
  - source: "ingredients"
    target: "ingredient"
    transformation: |
      dto.ingredients?.map(ing => ({
        item: createReference('Substance', ing.id, ing.name),
        ...(ing.strength && {
          strength: {
            numerator: { 
              value: parseFloat(ing.strength.split(' ')[0]), 
              unit: ing.strength.split(' ')[1] || 'mg' 
            }
          }
        })
      }))
    optional: true
    condition: "dto.ingredients && dto.ingredients.length > 0"
    isArray: true
    utilityFunctions:
      - "createReference"

# Custom transformation functions
customTransformations:
  - name: "mapMedicationStatus"
    parameters:
      - name: "status"
        type: "string"
    returnType: "'active' | 'inactive' | 'entered-in-error'"
    code: |
      function mapMedicationStatus(status: string): 'active' | 'inactive' | 'entered-in-error' {
        const normalized = status?.toLowerCase().trim();
        if (normalized === 'active' || normalized === 'available') {
          return 'active';
        }
        if (normalized === 'inactive' || normalized === 'discontinued') {
          return 'inactive';
        }
        return 'entered-in-error';
      }

# Generation options
generation:
  generateFiles:
    - "service-client"
    - "adapter"
    - "handler"
  options:
    addComments: true
    addJSDoc: true
    includeValidation: true
    formatCode: true
```

---

## Step 3: Validate Configuration

Before generating code, validate your configuration:

```bash
cd tools/fhir-mapper-generator
node dist/index.js validate -c ../../configs/medication-mapping.yaml
```

Expected output:
```
📋 Validating configuration: ../../configs/medication-mapping.yaml
✅ Configuration is valid
   Service: medication-service
   FHIR Resource: Medication
   Mappings: 6
```

---

## Step 4: Preview Generated Code (Dry Run)

Preview what will be generated without writing files:

```bash
node dist/index.js generate -c ../../configs/medication-mapping.yaml --dry-run
```

This shows you:
- Service client code
- Adapter code
- Handler code

Review the output to ensure it looks correct.

---

## Step 5: Generate the Code

Once you're satisfied with the preview, generate the actual files:

```bash
# From workspace root
cd tools/fhir-mapper-generator
node dist/index.js generate -c ../../configs/medication-mapping.yaml
```

Expected output:
```
📋 Configuration loaded successfully
   Service: medication-service
   FHIR Resource: Medication

🔨 Generating service client...
   ✅ Generated: apps/fhir-gateway/src/services/medication-service.client.ts

🔨 Generating adapter...
   ✅ Generated: libs/fhir/src/adapters/medication/medication.adapter.ts

🔨 Generating handler...
   ✅ Generated: apps/fhir-gateway/src/handlers/medication.ts

✅ Code generation completed successfully!

📝 Next steps:
   1. Review the generated code
   2. Update serverless.yml with the new function
   3. Update index.ts files with new exports
   4. Run TypeScript compilation to verify
```

---

## Step 6: Review Generated Files

### 6.1 Service Client
**Location**: `apps/fhir-gateway/src/services/medication-service.client.ts`

This file contains:
- HTTP client for calling your microservice
- Error handling (401, 403, 404, 429, 500)
- Authorization header forwarding
- Correlation ID support

**What to check:**
- ✅ API endpoint is correct
- ✅ Environment variable name matches your setup
- ✅ Error handling looks appropriate

### 6.2 Adapter
**Location**: `libs/fhir/src/adapters/medication/medication.adapter.ts`

This file contains:
- DTO to FHIR transformation logic
- All your field mappings
- Custom transformation functions
- Utility function usage

**What to check:**
- ✅ All mappings are present
- ✅ Transformations look correct
- ✅ Custom functions are included
- ✅ Optional fields are handled properly

### 6.3 Handler
**Location**: `apps/fhir-gateway/src/handlers/medication.ts`

This file contains:
- AWS Lambda handler function
- Request validation
- Service client invocation
- Adapter transformation
- FHIR response formatting

**What to check:**
- ✅ Path parameter extraction is correct
- ✅ Error responses are appropriate
- ✅ Logging is included

---

## Step 7: Update Serverless Configuration

Add the new Lambda function to `apps/fhir-gateway/serverless.yml`:

```yaml
functions:
  getMedication:
    handler: src/handlers/medication.main
    timeout: 10
    memorySize: 256
    events:
      - http:
          path: fhir/medication/{id}
          method: get
          cors:
            origin: ${self:custom.cors.origin}
            headers: ${self:custom.cors.headers}
```

---

## Step 8: Update Index Exports

### 8.1 Export Adapter

Add to `libs/fhir/src/index.ts`:

```typescript
export * from './adapters/medication/medication.adapter';
```

### 8.2 Export Handler (if needed)

If you have a handlers index file, add:

```typescript
export * from './handlers/medication';
```

---

## Step 9: Add DTO Type Definition

Create or update `libs/fhir/src/types/internal.ts` to include your DTO:

```typescript
export interface MedicationDTO {
  medicationId: string;
  code: string;
  codeDisplay: string;
  status: string;
  form?: string;
  strength?: string;
  manufacturer?: {
    id: string;
    name: string;
  };
  ingredients?: Array<{
    id: string;
    name: string;
    strength?: string;
  }>;
}
```

---

## Step 10: Create FHIR Model (if needed)

If the FHIR resource model doesn't exist, create `libs/fhir/src/models/r4/medication.ts`:

```typescript
import { Resource } from './common';

export interface Medication extends Resource {
  resourceType: 'Medication';
  id: string;
  status?: 'active' | 'inactive' | 'entered-in-error';
  code?: CodeableConcept;
  form?: CodeableConcept;
  manufacturer?: Reference;
  ingredient?: MedicationIngredient[];
  // ... other FHIR Medication fields
}
```

---

## Step 11: Verify TypeScript Compilation

Compile to check for errors:

```bash
# From workspace root
npx nx build fhir
npx nx build fhir-gateway
```

Fix any TypeScript errors that appear.

---

## Step 12: Test the Generated Code

### 12.1 Unit Test the Adapter

Create `libs/fhir/src/adapters/medication/medication.adapter.spec.ts`:

```typescript
import { toMedication } from './medication.adapter';
import { MedicationDTO } from '../../types/internal';

describe('toMedication', () => {
  it('should convert MedicationDTO to FHIR Medication', () => {
    const dto: MedicationDTO = {
      medicationId: 'med-123',
      code: '123456',
      codeDisplay: 'Aspirin 81mg',
      status: 'active',
    };

    const result = toMedication(dto);

    expect(result.resourceType).toBe('Medication');
    expect(result.id).toBe('med-123');
    expect(result.status).toBe('active');
  });
});
```

### 12.2 Integration Test

Test the full flow:
1. Deploy the microservice
2. Deploy fhir-gateway
3. Make a request: `GET /fhir/medication/med-123`
4. Verify the FHIR response

---

## Step 13: Common Adjustments

### Adding Query Parameters

If your API needs query parameters:

```yaml
service:
  queryParameters:
    - name: "includeHistory"
      type: "boolean"
      optional: true
```

The generated handler will extract and pass these to the service client.

### Complex Nested Mappings

For complex nested structures, use multi-line transformations:

```yaml
mappings:
  - source: "complexField"
    target: "extension"
    transformation: |
      dto.complexField ? [{
        url: 'http://example.com/fhir/extension/complex',
        valueString: JSON.stringify(dto.complexField)
      }] : []
    isComplex: true
```

### Conditional Mappings

Use conditions for optional fields:

```yaml
mappings:
  - source: "optionalField"
    target: "extension"
    optional: true
    condition: "dto.optionalField && dto.optionalField.value"
    transformation: "createExtension(...)"
```

---

## Troubleshooting

### Issue: Generated code has TypeScript errors

**Solution**: 
1. Check that DTO types are defined in `libs/fhir/src/types/internal.ts`
2. Verify FHIR model exists in `libs/fhir/src/models/r4/`
3. Ensure utility functions are imported correctly

### Issue: Service client can't connect

**Solution**:
1. Check environment variable: `MEDICATION_SERVICE_URL`
2. Verify the base URL format
3. Check network connectivity

### Issue: Adapter transformation fails

**Solution**:
1. Review the transformation code in the adapter
2. Add null checks for optional fields
3. Verify utility functions are available

### Issue: Handler returns 404

**Solution**:
1. Check path parameter name matches (`{id}` vs `{medicationId}`)
2. Verify serverless.yml path matches handler
3. Check service client is finding the resource

---

## Next Steps

1. **Add Tests**: Write unit and integration tests
2. **Documentation**: Add API documentation
3. **Error Handling**: Customize error messages if needed
4. **Logging**: Adjust log levels and events
5. **Performance**: Monitor and optimize if needed

---

## Quick Reference Commands

```bash
# Initialize config
node dist/index.js init <service-name> -o config.yaml

# Validate config
node dist/index.js validate -c config.yaml

# Preview generation
node dist/index.js generate -c config.yaml --dry-run

# Generate code
node dist/index.js generate -c config.yaml

# Analyze existing patterns
node dist/index.js analyze --verbose
```

---

## Example: Complete Workflow

```bash
# 1. Navigate to tool directory
cd tools/fhir-mapper-generator

# 2. Create configuration
node dist/index.js init medication-service -o ../../configs/medication.yaml

# 3. Edit the configuration file (add your mappings)
# Use your favorite editor to edit ../../configs/medication.yaml

# 4. Validate
node dist/index.js validate -c ../../configs/medication.yaml

# 5. Preview
node dist/index.js generate -c ../../configs/medication.yaml --dry-run

# 6. Generate
node dist/index.js generate -c ../../configs/medication.yaml

# 7. Update serverless.yml and index.ts files manually

# 8. Build and test
cd ../..
npx nx build fhir
npx nx build fhir-gateway
```

---

## Tips

1. **Start Simple**: Begin with direct field mappings, then add transformations
2. **Use Dry Run**: Always preview before generating
3. **Review Patterns**: Use `analyze` command to see existing patterns
4. **Incremental**: Generate, test, adjust, regenerate
5. **Version Control**: Commit your configuration file to git

---

## Support

For issues or questions:
- Check `docs/FHIR_MAPPING_AI_AGENT_GUIDE.md` for detailed patterns
- Review `docs/PATTERN_ANALYSIS.md` for existing code patterns
- See `docs/mapping-config-example.yaml` for more examples

