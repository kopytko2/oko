# Oko Installation Guide

Oko lets Ona (your AI assistant) see and interact with your browser. Once installed, Ona can help you with tasks like capturing API traffic, filling forms, or taking screenshots.

## What You'll Need

- Google Chrome browser
- An Ona environment (the backend runs automatically)

## Installation Steps

### Step 1: Download the Extension

Download the extension file from your Ona environment:
- Look for `oko-extension.zip` in the file explorer
- Right-click and download it to your computer

### Step 2: Install in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Unzip the downloaded file
4. Click **Load unpacked** and select the unzipped folder

You should see "Oko - Browser Automation for Ona" appear in your extensions.

### Step 3: Connect to Ona

1. Ask Ona for the connection code (just say "give me the oko code")
2. Click the Oko extension icon in your Chrome toolbar
3. Click **Connect from Clipboard** (or paste into "Connection Code")
4. The status should change to "Connected"

That's it! Ona can now interact with your browser.

## What Can Ona Do With Oko?

Once connected, you can ask Ona to:

| Task | Example |
|------|---------|
| **See your tabs** | "What tabs do I have open?" |
| **Capture API traffic** | "Capture the network requests from this page" |
| **Take screenshots** | "Take a screenshot of this page" |
| **Click buttons** | "Click the submit button" |
| **Fill forms** | "Fill in the email field with test@example.com" |
| **Navigate** | "Open google.com in a new tab" |

## Troubleshooting

**Extension shows "Disconnected"**
- Ask Ona for a new connection code, then click **Connect from Clipboard** again

**Can't find the extension icon**
- Click the puzzle piece icon in Chrome's toolbar
- Pin Oko to keep it visible

**"Developer mode" warning**
- This is normal for unpacked extensions
- Click "Dismiss" or ignore it

## Privacy & Security

- Oko only works when connected to your Ona environment
- Connection codes expire after 24 hours
- Network capture only happens when you explicitly ask for it
- No data is stored permanently - everything is in memory only

## Need Help?

Just ask Ona! Say something like:
- "Is Oko connected?"
- "Help me set up Oko"
- "What can you do with my browser?"
