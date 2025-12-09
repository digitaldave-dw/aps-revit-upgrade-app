# CLAUDE.md - Project Guide for Claude Code

## Project Overview

**APS Revit File Upgrader** - A full-stack web application that automates upgrading Autodesk Revit files (projects, families, templates) to newer versions (2023/2024/2025) using APS (Autodesk Platform Services) Design Automation API with real-time WebSocket progress tracking.

## Tech Stack

- **Backend:** Node.js 14+, Express 4.17.2, Socket.IO 4.7.2
- **Frontend:** jQuery 3.3.1, Bootstrap 3.4.1, jsTree 3.3.7
- **APS Integration:** forge-apis 0.9.7
- **Revit Plugin:** C# / .NET Framework 4.8 (2023/2024) or .NET 8 (2025) / Revit API

## Directory Structure

```
routes/                      # Express.js API routes
  ├── oauth.js              # OAuth2 authentication
  ├── da4revit.js           # Main Design Automation endpoints (bulk processing)
  ├── datamanagement.js     # BIM360 file/folder operations
  └── common/               # Implementation modules
      ├── oauthImp.js       # OAuth token management
      ├── da4revitImp.js    # Workitem processing logic
      └── versionDetection.js # Revit version detection engine
public/                      # Frontend static files
  ├── js/APSTree.js         # BIM360 tree browser UI
  ├── bundles/              # Pre-compiled DA AppBundles (.zip)
  └── index.html            # Main application UI
FileUpgrader/               # Revit plugin source (.NET/C#)
  └── PlugIn/Source/        # Plugin code (Command.cs)
```

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (default port 8080)
```

## Required Environment Variables

```
APS_CLIENT_ID
APS_CLIENT_SECRET
APS_CALLBACK_URL         # e.g., http://localhost:3000/api/aps/callback/oauth
APS_WEBHOOK_URL          # e.g., http://<ngrok-url>/api/aps/callback/designautomation
DESIGN_AUTOMATION_NICKNAME
DESIGN_AUTOMATION_ACTIVITY_NAME
DESIGN_AUTOMATION_ACTIVITY_ALIAS
```

## Key Patterns

- **OAuth:** Three-legged (user auth) and two-legged (app auth) flows via `OAuth` class
- **Bulk Processing:** `BulkProcessingQueue` manages concurrent upgrades (max 5 files)
- **Workitem Tracking:** `WorkitemTracker` class monitors active/completed/failed jobs
- **Version Detection:** `EnhancedRevitVersionDetector` with multi-level caching
- **Real-Time Updates:** Socket.IO events: `'Workitem-Notification'`, `'Bulk-Progress-Notification'`

## Key Files

| File | Purpose |
|------|---------|
| `routes/da4revit.js` | Main upgrade API endpoints, bulk job management |
| `routes/common/versionDetection.js` | Revit version detection, workshared file filtering |
| `public/js/APSTree.js` | BIM360 tree navigation, file selection UI |
| `config.js` | Centralized configuration (scopes, endpoints) |
| `start.js` | Server initialization, middleware setup |

## Important Constraints

- Max 5 concurrent file upgrades
- Workshared files are automatically skipped
- Only supports upgrade to Revit 2023, 2024, and 2025
- Works only with BIM360 (not local files)
- Requires valid APS credentials and app provisioning

## Deployment

- Heroku-ready (see `app.json`)
- Use ngrok for local webhook tunneling during development
