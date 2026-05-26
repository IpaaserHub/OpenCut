# Agents.md

## Architecture

An ongoing migration is moving all business logic into `rust/`. Each app under `apps/` is a UI shell — it owns rendering, interaction, and platform-specific concerns, but never owns logic. The UI framework for any given app is a replaceable detail.

### `rust/`

The single source of truth for all non-UI code. Everything platform-agnostic belongs here: no components, no hooks, no framework imports.

### `apps/`

Each app is a frontend that calls into Rust. Logic is never duplicated between apps — only UI is, because each platform may use an entirely different framework and language to build it.

- `web/` — Next.js
- `desktop/` — GPUI

## Web

### React

- Read components before using them. They may already apply classes, which affects what you need to pass and how to override them.

## SNSDir Deployment Scope

For SNSDir-related work, "deploy", "merge to production", or "merge to the
deployment environment" does not mean deploying this shared editor alone.
Delivery is complete only when:

- The shared editor change is deployed.
- The change is usable through every integrated SNSDir production app,
  currently YTDir (`yt-dir.com`) and TKDir (`tkdir.com`), including tenant
  subdomains where applicable.
- The affected workflow is verified for the intended user roles, or any
  unverified service or role is explicitly reported as incomplete.

