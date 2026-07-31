<div align="center">

# ZenCode 🧘

**The intelligent anti-burnout companion for VS Code.**

[![Version](https://img.shields.io/visual-studio-marketplace/v/SairajDev.zencode?color=7c6af7&label=version&style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/SairajDev.zencode?color=7c6af7&style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/SairajDev.zencode?color=7c6af7&style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode)
[![License](https://img.shields.io/github/license/Sairaj-creator/zencode?color=7c6af7&style=for-the-badge)](https://github.com/Sairaj-creator/zencode/blob/main/LICENSE)

*Stop coding until you break. Start coding until you're done.*

</div>

---

ZenCode silently watches your typing patterns — rhythm, error rate, pause frequency, and session length — and surfaces a **real-time fatigue score** in your status bar before burnout hits. No distractions. No popups unless you want them. Just a quiet signal that it's time to breathe.

---

## ✨ Features

### 🧘 Status Bar Monitoring
ZenCode lives in your status bar and stays out of your way. At a glance:
- 🟢 **Zen** — You're in the flow. Keep going.
- 🟠 **Fatigued** — Your error rate is climbing. Maybe take a breath?
- ⏳ **Warming up** — Not enough data yet. ZenCode needs a few minutes to calibrate.

### 📊 Wellness Dashboard
Click the status bar item or run **`ZenCode: Open Wellness Dashboard`** to open a live chart showing your fatigue score history over time — styled to match your VS Code theme.

### 🛡️ Smart Fatigue Scoring
The fatigue score is built from five real signals, not guesses:

| Signal | Weight | What it measures |
| :--- | :---: | :--- |
| Error rate | 45% | Ratio of deletions to total keystrokes |
| Session duration | 15% | How long you've been actively coding |
| Typing rhythm | 15% | Variance in your keystroke timing |
| Undo/redo rate | 15% | How often you're reversing decisions |
| Pause frequency | 10% | Hesitation patterns within your window |

Scores only appear after you've typed enough **and** been coding long enough — so a quick paste or undo burst will never spike your score unfairly.

### 💆 Wellness Reminders
ZenCode can gently nudge you with optional reminders:
- **💧 Hydration** — Reminds you to drink water on your schedule.
- **🪑 Posture** — Periodic posture check-ins.
- **👁️ Eye exercises** — The 20-20-20 rule, built in.
- **☕ Smart breaks** — Suggests a break after long active sessions.

### ⚙️ Highly Configurable
Control every aspect from VS Code settings — scope it to specific languages, workspaces, or hours of the day.

---

## 🚀 Getting Started

1. Install **ZenCode** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode).
2. Start typing — the extension activates automatically.
3. Check the **status bar** (bottom right) for your live score.
4. Run **`ZenCode: Open Wellness Dashboard`** to see your fatigue trends.

---

## ⚙️ Configuration

| Setting | Default | Description |
| :--- | :---: | :--- |
| `zencode.enabled` | `true` | Enable or disable all monitoring. |
| `zencode.fatigueThreshold` | `20` | Score % above which warnings appear. |
| `zencode.strictMode` | `false` | Show modal warnings when fatigue is high. |
| `zencode.autoZenMode` | `false` | Auto-enable VS Code Zen Mode on fatigue. |
| `zencode.minimumSessionMinutes` | `3` | Minimum session time before scoring begins. |
| `zencode.minimumKeystrokeThreshold` | `50` | Minimum keystrokes before scoring begins. |
| `zencode.samplingWindowMinutes` | `5` | Rolling window used to calculate signals. |
| `zencode.smartBreakDuration` | `45` | Minutes of active coding before suggesting a break. |
| `zencode.wellnessNotifications` | `true` | Enable hydration, posture, and eye reminders. |
| `zencode.hydrationInterval` | `30` | Minutes between hydration reminders (0 = off). |
| `zencode.postureReminderInterval` | `60` | Minutes between posture reminders (0 = off). |
| `zencode.eyeExerciseInterval` | `20` | Minutes between eye exercise reminders (0 = off). |
| `zencode.notificationStyle` | `normal` | How loudly to notify: `subtle`, `normal`, `aggressive`. |
| `zencode.statusBarPosition` | `right` | Status bar side: `left` or `right`. |
| `zencode.excludedLanguages` | `[]` | Language IDs to skip monitoring. |
| `zencode.excludedWorkspaces` | `[]` | Workspace paths to skip monitoring. |
| `zencode.workdayStartHour` | `0` | Hour to start monitoring (0 = all day). |
| `zencode.workdayEndHour` | `0` | Hour to stop monitoring (0 = all day). |
| `zencode.dataRetentionDays` | `30` | Days to keep local fatigue history. |

---

## 📜 Changelog

### v1.0.1 — Fatigue Scoring Logic Fix
- **Fixed:** Fatigue score no longer spikes on bulk edits (paste, format-on-save, undo bursts).
- **Fixed:** Stale interval data from hours-old pauses is now pruned by time, not by count.
- **Added:** Minimum session time gate — scores only appear after you've genuinely been coding for a few minutes.
- **Improved:** Typing rhythm variance now excludes pause intervals for a cleaner signal.
- **Improved:** Undo/redo weight increased from 10% → 15% for more accurate fatigue detection.

---

<div align="center">

*Built with ❤️ for developers who forget to take breaks.*

</div>