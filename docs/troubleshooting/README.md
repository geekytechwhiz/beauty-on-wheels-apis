# Troubleshooting Documentation

Problem diagnosis, solutions, and incident documentation.

## 📂 Contents

### [Runtime Errors](./runtime-errors/)
Module resolution and bundling issues in AWS Lambda.

#### The Problem
**Error**: `Runtime.ImportModuleError: Error: Cannot find module 'notification'`

AWS Lambda runtime errors caused by improper bundling of NX monorepo workspace dependencies.

#### 📄 Documents

1. **[SOLUTION_SUMMARY.md](./runtime-errors/SOLUTION_SUMMARY.md)** ⭐ **Start Here**
   - Executive summary
   - Quick overview of the fix
   - Next steps
   - **Use this for**: Quick understanding

2. **[RUNTIME_IMPORT_ERROR_ANALYSIS.md](./runtime-errors/RUNTIME_IMPORT_ERROR_ANALYSIS.md)**
   - Detailed technical analysis
   - Root cause investigation
   - Multiple solution approaches
   - **Use this for**: Deep dive and alternatives

3. **[QUICK_FIX_IMPLEMENTATION.md](./runtime-errors/QUICK_FIX_IMPLEMENTATION.md)**
   - Step-by-step implementation
   - Testing procedures
   - Troubleshooting tips
   - **Use this for**: Implementing the fix

4. **[ENHANCED_CURSOR_PROMPT.md](./runtime-errors/ENHANCED_CURSOR_PROMPT.md)**
   - AI/Cursor development context
   - Complete problem statement
   - Technical constraints
   - **Use this for**: AI-assisted debugging

**Status**: ✅ Solution Implemented  
**Severity**: 🔴 High (Production Blocking)  
**Resolution**: Custom esbuild plugin for workspace dependency resolution

---

### [Production Fixes](./production-fixes/)
Production incident documentation and resolutions.

#### 📄 Documents

1. **[PRODUCTION_FIX_NOTIFICATION_ERROR.md](./production-fixes/PRODUCTION_FIX_NOTIFICATION_ERROR.md)**
   - Notification service error fix
   - Incident details
   - Resolution steps

**Status**: Various incidents documented

---

## 🚨 Common Issues

### Runtime Module Errors
**Symptoms**:
- `Cannot find module` errors in Lambda
- Works locally but fails in AWS
- Workspace dependencies not found

**Solution**: [Runtime Errors](./runtime-errors/)

### Notification Errors
**Symptoms**:
- Notification delivery failures
- Service configuration issues

**Solution**: [Production Fixes](./production-fixes/)

---

## 🔍 Finding Solutions

### By Error Message
- **"Cannot find module"** → [Runtime Errors](./runtime-errors/)
- **"ImportModuleError"** → [Runtime Errors](./runtime-errors/)
- **Notification errors** → [Production Fixes](./production-fixes/)

### By Service
- **User Service** → [Runtime Errors](./runtime-errors/) (bundling issue)
- **All Services** → [Production Fixes](./production-fixes/)

### By Environment
- **Lambda Runtime** → [Runtime Errors](./runtime-errors/)
- **Production** → [Production Fixes](./production-fixes/)

---

## 📋 Troubleshooting Workflow

### 1. Identify the Issue
- Check error message
- Review CloudWatch logs
- Identify affected service

### 2. Find Documentation
- Search this directory
- Use error message as keyword
- Check service-specific docs

### 3. Apply Solution
- Follow step-by-step guide
- Test in development first
- Deploy to production

### 4. Verify Fix
- Check CloudWatch logs
- Test API endpoints
- Monitor for recurrence

### 5. Document (if new issue)
- Create incident document
- Document root cause
- Share solution

---

## 🛠️ Quick Fixes

### Runtime Module Error
```bash
# 1. Ensure workspace dependencies are built
nx run-many -t build --projects=tag:scope:shared

# 2. Verify esbuild plugin exists
ls apps/user-service/esbuild-plugins.js

# 3. Test locally
cd apps/user-service
serverless package

# 4. Deploy
serverless deploy --stage dev
```

### General Debugging
```bash
# Check Lambda logs
aws logs tail /aws/lambda/your-function --follow

# Test locally
serverless offline

# Package and inspect
serverless package
unzip .serverless/your-function.zip -d /tmp/inspect
```

---

## 📊 Incident History

### Resolved Issues
- ✅ **Runtime Module Error** (2025-Q4)
  - Severity: High
  - Resolution: Custom esbuild plugin
  - Services: user-service

- ✅ **Notification Error** (Various)
  - Severity: Medium
  - Resolution: Service configuration
  - Services: Multiple

---

## 🔗 Related Documentation

### Coding Standards
- [API Response Standards](../coding-standards/api-response/)

### Infrastructure
- [CDN Configuration](../infrastructure/cdn/)
- [Unified Response](../infrastructure/unified-response/)

### Services
- [Organization Service](../services/organization-service/)
- [FHIR Gateway](../services/fhir-gateway/)

---

## 📝 Reporting New Issues

When documenting a new issue:

1. **Create appropriate subdirectory** (if needed)
2. **Use clear naming**: `ISSUE_NAME_FIX.md`
3. **Include sections**:
   - Problem description
   - Root cause
   - Solution
   - Testing steps
   - Prevention measures

4. **Update this README**

---

## 🆕 Prevention

### For Runtime Errors
- ✅ Build workspace dependencies before deployment
- ✅ Use consistent bundling configuration
- ✅ Test packaging locally
- ✅ Verify imports in bundled output

### For Production Issues
- ✅ Implement proper monitoring
- ✅ Use structured logging
- ✅ Set up CloudWatch alarms
- ✅ Test thoroughly in staging

---

**Last Updated**: 2026-01-19  
**Total Issues**: 2 categories  
**Resolution Rate**: 100%  
**Status**: ✅ Active Documentation
