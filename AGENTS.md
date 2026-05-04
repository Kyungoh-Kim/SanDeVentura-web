# Codex Agent Rules

## Commit Message Conventions

Follow these rules for every commit in this repository.

### Basic Rules

1. Separate subject and body with one blank line.
2. Keep the subject line 50 characters or less.
3. Capitalize the first letter of the subject.
4. Do not end the subject with a period.
5. Use the imperative mood in the subject, for example `Add`, not `Added`.
6. Wrap body lines at 72 characters.
7. In the body, explain what and why, not only how.

### Structure

```text
<type>: <subject>

<body>

<footer>
```

Subject is required. Body and footer are optional when the subject is
enough.

### Types

| Type | Use |
|------|-----|
| `feat` | New feature or behavior change to meet requirements |
| `fix` | Bug fix |
| `build` | Build system or dependencies |
| `chore` | Misc maintenance, such as package manager or `.gitignore` |
| `ci` | CI configuration |
| `docs` | Documentation or comments |
| `style` | Formatting or style only, with no logic change |
| `refactor` | Refactor without behavior change |
| `test` | Tests |
| `release` | Version release |

### Language

Prefer English for `type`, subject, and body so logs and tooling stay
consistent. Project docs for humans may still use Korean elsewhere.

