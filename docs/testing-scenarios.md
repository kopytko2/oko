# Frontend Testing Scenarios

Oko supports declarative browser testing scenarios through:

```bash
npm run oko -- test run <scenario.yaml> [--tab-id N] [--strict]
```

The runner executes steps in order and stops on the first failure.

- Exit code `0`: all steps passed
- Exit code `1`: assertion failure or runtime failure
- Exit code `2`: usage or schema validation error

## Schema (MVP)

```yaml
version: 1
defaults:
  tab: active
  timeoutMs: 5000
  pollMs: 100
  typingDelayMs: 35
  profile: deterministic
steps:
  - navigate: { url: "https://example.com/login" }
  - wait: { condition: element, selector: "input[name=email]", state: visible }
  - type: { selector: "input[name=email]", text: "test@example.com", clear: true }
  - type: { selector: "input[name=password]", text: "secret", clear: true }
  - click: { selector: "button[type=submit]", mode: human }
  - wait: { condition: url, urlIncludes: "/dashboard" }
  - assert: { selector: "h1", textContains: "Dashboard" }
```

## Supported step types

- `navigate`
- `wait`
- `hover`
- `click`
- `type`
- `key`
- `scroll`
- `assert`
- `screenshot`

## Step reference

### navigate

```yaml
- navigate:
    url: "https://example.com"
    tabId: 123        # optional
    newTab: false     # optional
    active: false     # optional (default: false, background-first)
```

### wait

```yaml
- wait:
    condition: element            # element | url
    selector: "#login-button"   # required for element
    state: visible               # present | visible | hidden
    timeoutMs: 5000
    pollMs: 100
```

```yaml
- wait:
    condition: url
    urlIncludes: "/dashboard"   # required for url
```

### hover

```yaml
- hover:
    selector: "button.primary"
```

### click

```yaml
- click:
    selector: "button[type=submit]"
    mode: human                  # human | native
```

### type

```yaml
- type:
    selector: "input[name=email]"
    text: "test@example.com"
    clear: true
    delayMs: 35
```

### key

```yaml
- key:
    key: Enter
    modifiers: [Shift]
```

### scroll

```yaml
- scroll:
    deltaY: 400
    behavior: smooth             # auto | smooth
```

```yaml
- scroll:
    selector: ".results"
    to: bottom                   # top | bottom
```

### assert

```yaml
- assert:
    selector: "h1"
    textContains: "Dashboard"
```

Available assertion fields:
- `visible`
- `enabled`
- `textContains`
- `valueEquals`
- `urlIncludes`

### screenshot

```yaml
- screenshot:
    fullPage: true
    out: "artifacts/dashboard.png"
```

## Determinism defaults

The MVP is deterministic by design:
- no random timing jitter
- fixed typing delay (`defaults.typingDelayMs`, default `35`)
- fixed wait polling (`defaults.pollMs`, default `100`)
