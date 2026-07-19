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


## リポジトリ構成と本番反映経路 (Two-repo structure & production path)

このプロジェクトは2つのリポジトリで運用されている。**このリポジトリ (`IpaaserHub/OpenCut`) は試作・実験用フォークであり、ここでの変更は本番に一切反映されない。**

| リポジトリ | 役割 | 本番への配線 |
|---|---|---|
| `IpaaserHub/OpenCut` (このリポ) | 試作・実験用 (upstream OpenCut のフォーク) | **なし**。ここに何をマージしても tkdir.com / dev.tkdir.com には届かない |
| `IpaaserHub/opencut-editor` | 本番リポ。SNSDir (TKDir / YTDir) のエディタ実体 | main → 手動デプロイ → Vercel `opencut-jp` |

```text
IpaaserHub/OpenCut (fork=試作)      IpaaserHub/opencut-editor (本番)
      │                                  dev (統合ブランチ)
      │ 機能を移植 (port PR)               │ release PR
      └───────────────────────────▶ main
                                         │ 手動デプロイ (マージ自動デプロイなし)
                                         ▼
                                  Vercel project: opencut-jp
                                         │
             ┌───────────────────────────┼───────────────────────────┐
       tkdir.com のエディタ         test.tkdir.com               dev.tkdir.com
             （3つとも同じ1つのデプロイを参照。環境の分離は無い）
```

- ここで作った機能を本番に出す手順: fork で試作 → `opencut-editor` へ移植 PR → main マージ → 手動デプロイ。移植しない限り本番には存在しない (移植例: timeline ripple → opencut-editor #71, text templates → #26–#29)。
- デプロイ手順の詳細は opencut-editor 側の `AGENTS.md`「Production Deployment」と `docs/opencut-vercel-routing.md` を参照。
- **dev.tkdir.com 専用環境は存在しない。** dev.tkdir.com / test.tkdir.com / tkdir.com は全て同じ opencut-jp 本番デプロイを参照しており、「dev にだけ反映」は現在の配線では不可。
