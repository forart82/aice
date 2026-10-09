# Project-Scoped Rules for dogMax

This file contains Workspace Customization Rules that all agents (Claude, Gemini, Antigravity/AGY) must follow without exception.

## Worktree & Concurrency Rules

- **Always work in a dedicated Git worktree**: Never execute modifications or commits directly in the main workspace directory.
- **Respect the Merge-Back Protocol (/cu)**: When a task is complete, run the `/cu` command tool to handle building, testing, merging (via the merge queue), and cleaning up. Do NOT manually merge or delete worktrees yourself.
- **Do NOT delete other worktrees**: Under no circumstances should any agent delete worktrees created by other agents.

## Code & Documentation Comments

- **Detailed Comments Requirement**: Every code comment (commentaire) must be highly detailed, explaining the reasoning, constraints, and side effects of the code, rather than just stating what the code does.

## Git Commit Rules

- **Detailed Commit Comments Requirement**: Every Git commit must include a comprehensive and detailed commit message/comment (commentaire). The message must explain the rationale, key changes, and context of the commit, rather than just a brief summary.

## Image Assets Rules

- **Never remove or overwrite already created image files**: Do not delete, clear, or overwrite any generated image assets (.png, .jpg, etc.) in the workspace, project directories, or output folders unless explicitly instructed by the user.
