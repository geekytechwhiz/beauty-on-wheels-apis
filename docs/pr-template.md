# 🚀 Pull Request

## 📌 Summary
<!-- What does this PR do? -->
- Feature / Fix / Refactor:
- Module:
- Related Ticket:

---

## 🧠 Changes Made
<!-- Describe key changes -->
- 
- 
- 

---

## 📋 PR Checklist (MANDATORY)

### 🏗️ Architecture
- [ ] No business logic in controller
- [ ] Service layer contains all business logic
- [ ] No direct DB access outside repository
- [ ] Proper module structure followed

### 🔌 API Standards
- [ ] API follows standard response format
- [ ] Request/response schema defined
- [ ] Proper HTTP status codes used
- [ ] Versioning followed (/v1/)

### 🔐 Security
- [ ] No hardcoded secrets
- [ ] Input validation implemented
- [ ] Sensitive data encrypted (if applicable)
- [ ] No sensitive data in logs

### 🏥 Healthcare Rules
- [ ] Patient data includes timestamp & source
- [ ] Care plan changes are versioned
- [ ] Audit logs added (if applicable)

### 🧪 Testing
- [ ] Unit tests added/updated
- [ ] Edge cases covered
- [ ] All tests passing

### 📝 Logging & Monitoring
- [ ] Structured logging added
- [ ] Error handling implemented
- [ ] Correlation ID used where applicable

### ⚡ Performance
- [ ] No unnecessary loops or heavy operations
- [ ] Pagination used for large data
- [ ] No N+1 queries

---

## 🧪 How to Test
<!-- Steps to test this PR -->
1.
2.
3.

---

## 📸 Screenshots / Logs (if applicable)

---

## ⚠️ Notes / Risks
<!-- Any known limitations or risks -->
- 

---

## 👀 Reviewer Focus Areas
<!-- What should reviewers focus on -->
- 