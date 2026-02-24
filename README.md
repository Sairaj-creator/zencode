# ZenCode 🧘
> The intelligent anti-burnout assistant for VS Code.

[![Installs](https://img.shields.io/visual-studio-marketplace/i/SairajDev.zencode)](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/SairajDev.zencode)](https://marketplace.visualstudio.com/items?itemName=SairajDev.zencode)
[![License](https://img.shields.io/github/license/SairajDev/zencode)](https://github.com/SairajDev/zencode)

---

**ZenCode** silently monitors your typing patterns to detect fatigue before it turns into burnout. It integrates seamlessly into your status bar, providing real-time feedback without breaking your flow.

![ZenCode Demo](https://raw.githubusercontent.com/SairajDev/zencode/main/images/demo.gif)
*(Add a 5-second GIF here showing the status bar changing and dashboard opening)*

## Features

### 🧘 Unintrusive Monitoring
ZenCode lives in your **Status Bar**. It shows your current "Zen" or "Fatigue" level at a glance.
- **Green (Zen):** You are in the flow.
- **Orange/Red (Fatigue):** Your error rate is increasing. Time to take a breath?

### 📊 Real-Time Dashboard
Click the status bar item to open the **ZenCode Dashboard**. Visualize your stress levels over time with a beautiful, theme-aware chart that matches your VS Code colors.

### ⚙️ Customizable
Control how ZenCode works in your User Settings:
- **Fatigue Threshold:** Set your own tolerance for errors (Default: 20%).
- **Strict Mode:** Optionally enforce a short break when burnout is detected (Default: Off).

## Installation

1. Install the extension.
2. The extension activates automatically when you start typing.
3. Check the **Status Bar** (bottom right) for your live score.
4. Click the status bar item or run `ZenCode: Open Stress Dashboard` to see detailed analytics.

## Configuration

| Setting | Default | Description |
| :--- | :--- | :--- |
| `zencode.fatigueThreshold` | `20` | Percentage of typos/backspaces that triggers a warning. |
| `zencode.strictMode` | `false` | If `true`, shows a modal warning when fatigue is high. |

---
*Built with ❤️ for developers who forget to take breaks.*