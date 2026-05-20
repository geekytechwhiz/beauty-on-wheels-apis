Objective: Implement schema module in core/schema/

Before coding:
- Check if validation library already exists (Joi/Zod/Yup)

Implement:

- validate(event: any, schema)

- Support:
  - per eventType schema

- Plug into consumer BEFORE handler

Tests:
- valid event passes
- invalid event fails