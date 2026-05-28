# ORB AI Extension Development Host - F5 Interface Guide

## What Opens When You Press F5

A **NEW VS Code window** opens with your extension running. This is called the **Extension Development Host**.

---

## Interface Layout

```
┌─────────────────────────────────────────────────────────┐
│  Extension Development Host [ORB AI]                    │  ← Window Title
├─────────────────────────────────────────────────────────┤
│ File  Edit  View  Go  Run  Terminal  Help               │  ← Menu Bar
├─────────────────────────────────────────────────────────┤
│  📁 EXPLORER         │                                   │
│  ├── .vscode         │  (Empty editor area)              │
│  ├── dist            │                                   │
│  ├── src             │  You can open files here          │
│  ├── node_modules    │  Or just run commands             │
│  └── package.json    │                                   │
│                      │                                   │
├──────────────────────┼───────────────────────────────────┤
│ PROBLEMS │ OUTPUT    │  (Panel at bottom - shows logs)   │
│ ↑ Click OUTPUT tab   │                                   │
└──────────────────────┴───────────────────────────────────┘
```

---

## Key Areas You'll Use

### 1️⃣ Command Palette (Top Center)
**Where you run ORB AI commands**

```
Press: Ctrl + Shift + P
```

A search box appears at the top. Type your command.

---

### 2️⃣ Output Panel (Bottom of window)
**Where scan results appear**

```
View → Output
Or: Click "OUTPUT" tab at the bottom
Or: Ctrl + ` then select "ORB AI Analysis"
```

Shows:
- 📁 Repository Structure
- 🔍 Detected Frameworks
- 📦 Dependencies
- Import graph analysis

---

## Step-by-Step To Run Commands

### Command 1: Hello World Test

```
1. Press Ctrl + Shift + P
   ↓
2. Type: "Hello World"
   ↓
3. Click: "ORB AI: Hello World"
   ↓
4. You see notification: "Hello World from ORB AI!"
```

---

### Command 2: Scan Repository

```
1. Press Ctrl + Shift + P
   ↓
2. Type: "Scan Repository"
   ↓
3. Click: "ORB AI: Scan Repository"
   ↓
4. Progress indicator shows: "ORB AI: Scanning repository..."
   ↓
5. View → Output (or Ctrl + `)
   ↓
6. Select "ORB AI Analysis" from dropdown
   ↓
7. Read the report:
   - Total files found
   - Frameworks detected
   - Dependencies listed
```

---

## What Each Panel Shows

### EXPLORER Panel (Left)
- File tree of your workspace
- Can open/edit files here
- Not needed for running commands

### EDITOR Area (Center)
- Shows opened files
- Or empty if no file is open
- Not needed for running commands

### OUTPUT Panel (Bottom)
- Shows command results
- Shows VS Code extension logs
- **This is where you see scan results**

### PROBLEMS Panel (Bottom)
- Shows TypeScript/linting errors
- Ignore if green (no errors)

---

## Common Actions

| Action | Keys |
|--------|------|
| Open Command Palette | `Ctrl + Shift + P` |
| Open Output Panel | `Ctrl + \`` |
| Close Extension Dev Host | `Alt + F4` or close window |
| Reload Extension | `Ctrl + Shift + F5` |
| Toggle Sidebar | `Ctrl + B` |
| Full Screen | `F11` |

---

## Notifications You'll See

### ✅ Success Notification
```
"Repository scan complete!"
"Hello World from ORB AI!"
```

### ⚠️ Warning (if no workspace open)
```
"No workspace folder is open"
→ Solution: Open a folder first (File → Open Folder)
```

### 🔴 Error (rare)
```
"Repository scan failed: [error details]"
→ Check OUTPUT panel for details
```

---

## Your Workspace is Already Open!

The Extension Development Host opened with **this repo** (ORB-AI-Orchestrated-Reasoning-Brain) as the workspace.

So:
- ✅ You can immediately run "Scan Repository"
- ✅ It will scan **this project's files**
- ✅ Results show in OUTPUT panel

---

## Next: Try Running Commands

**In the new VS Code window that opened:**

1. Press `Ctrl + Shift + P`
2. Type `Scan Repository`
3. Hit Enter
4. Check the OUTPUT panel (bottom) for results

That's it! 🚀
