# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | Yes |

## Threat Model

Crossfire executes locally against Git repositories that may contain **untrusted branch names, untrusted filenames, and untrusted source code snippets** (for example when scanning pull requests or parallel agent branches). We treat the following as high-severity security vulnerabilities:

1. **Command / Argument Injection** via crafted branch names, worktree paths, or filenames passed to `git`.
2. **Cross-Site Scripting (XSS)** in generated `report.html` files via crafted Git refs, filenames, or source code lines.
3. **Unintended Working-Tree or Index Mutation** during read-only commands (`scan`, `check`, `report`).
4. **Arbitrary File Overwrite / Path Traversal** outside expected target locations.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for exploitable security bugs. Instead, use GitHub's **Private Vulnerability Reporting** ("Report a vulnerability" under the repository's **Security** tab) with:

- Affected command and Crossfire version
- Minimal reproduction script or Git repository setup
- Impact description and suggested remediation (if any)

We aim to acknowledge reports within 72 hours and ship a tested fix prior to public disclosure.
