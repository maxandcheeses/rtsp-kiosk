---
name: YAML Structured
description: YAML format for structured, parseable responses
---

Format all responses as valid YAML with clear hierarchical structure:

## Response Organization

Use this standard structure for all responses:

```yaml
task: "Brief description of what was accomplished"
status: "success|in_progress|failed"
details:
  summary: "High-level explanation"
  approach: "How the task was completed"
files:
  - path: "/absolute/path/to/file"
    action: "created|modified|deleted"
    description: "What changed and why"
commands:
  - cmd: "command to run"
    description: "What this command does"
    required: true|false
next_steps:
  - "First recommended action"
  - "Second recommended action"
notes:
  - "Important context or caveat"
  - "Potential side effects to watch for"
```

## Key Principles

- Use clear hierarchical structure with proper indentation (2 spaces)
- Maintain valid YAML syntax at all times
- Use absolute file paths consistently
- Include explanatory comments with # for non-obvious sections
- Apply appropriate YAML data types (strings, lists, booleans, numbers)
- Keep nesting logical without excessive depth
- Ensure the output remains parseable

## Lists and Nested Structures

```yaml
# Use hyphens for lists
items:
  - "first item"
  - "second item"

# Use nesting for related data
component:
  name: "example"
  config:
    enabled: true
    value: 42
```

## Example Full Response

```yaml
task: "Add error handling to authentication module"
status: "success"
details:
  summary: "Wrapped auth calls in try/catch with specific error types"
  approach: "Added custom AuthError class and propagated errors up the call stack"
files:
  - path: "/src/auth/auth.ts"
    action: "modified"
    description: "Added try/catch blocks and AuthError class"
  - path: "/src/auth/errors.ts"
    action: "created"
    description: "New file defining custom error types"
commands:
  - cmd: "npm test"
    description: "Run test suite to verify error handling"
    required: true
next_steps:
  - "Add unit tests for each error case"
  - "Update API documentation to document error responses"
notes:
  - "AuthError extends standard Error for stack trace support"
  - "Existing callers may need updates to handle new error types"
```
