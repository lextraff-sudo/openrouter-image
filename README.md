# openrouter-image.ts

Pi extension for generating images via [OpenRouter API](https://openrouter.ai/). 40+ models including Krea, Flux, Gemini, GPT, Recraft, Sourceful, Seedream, Microsoft MAI, and xAI Grok.

---

## Features

*   **Persistent Defaults** — Last-used model & aspect ratio saved across sessions
*   **Interactive Commands** — `/set-image-model`, `/set-image-ratio`, `/list-image-models`
*   **Auto-Persist** — Every generated image updates the default model/ratio for next use
*   **40+ Models** — From $0.001/image (Gemini) to $0.30 (Recraft Pro Vector)

---

## Installation

1.  Place `openrouter-image.ts` in `~/.pi/agent/extensions/`
2.  Set `OPENROUTER_API_KEY` environment variable:
    ```bash
    export OPENROUTER_API_KEY='sk-or-v1-...'
    ```
3.  Restart Pi session

---

## Configuration

Settings are stored as JSON files in `~/.pi/agent/config/`:

### image-model.json
```json
{
  "modelId": "openai/gpt-image-2"
}
```
*Changed automatically when you pass a `model` parameter, or via `/set-image-model`.*

### image-aspect-ratio.json
```json
{
  "aspectRatio": "16:9"
}
```
*Changed automatically when you pass an `aspect_ratio` parameter, or via `/set-image-ratio`.*

---

## Usage

### Generate an image
Pass a prompt to the `generate_image` tool. Model & ratio use persisted defaults unless explicitly overridden:

```
generate_image({
  prompt: "A sunset over mountains",
  model: "krea/krea-2-medium",        // optional — changes default if set
  aspect_ratio: "16:9"                // optional — changes default if set
})
```

### Interactive commands

| Command | Description |
|---------|-------------|
| `/set-image-model` | Select default model from a menu |
| `/set-image-ratio` | Select default aspect ratio from a menu |
| `/list-image-models` | List all 40+ available models with pricing |

---

## Aspect Ratios

| Ratio | Resolution | Use Case |
|-------|-----------|----------|
| `1:1` | 1024×1024 | Square (default fallback) |
| `16:9` | 1792×1024 | Wide / landscape |
| `9:16` | 1024×1792 | Portrait / mobile |
| `4:3` | 1536×1024 | Classic |
| `3:4` | 1024×1536 | Classic portrait |
| `3:2` | 1536×1024 | Photography |
| `2:3` | 1024×1536 | Photo portrait |
| `auto` | Model default | Let the model decide |

---

## Model Selection Logic

The extension uses this priority chain:

```
params.model (from tool call)  →  saved config (image-model.json)  →  hardcoded fallback
params.aspect_ratio (from tool call)  →  saved config (image-aspect-ratio.json)  →  hardcoded fallback
```

**If you specify a model/ratio in a tool call, it becomes the new default** for future generations.

---

## API

All models use the same OpenRouter endpoint:

```
POST https://openrouter.ai/api/v1/images/generations
```

### Request Body
```json
{
  "model": "openai/gpt-image-2",
  "prompt": "Your prompt here",
  "aspect_ratio": "16:9",
  "image_config": {
    "aspect_ratio": "16:9",
    "width": 1792,
    "height": 1024
  }
}
```

### Response
```json
{
  "data": [{ "url": "https://...generated-image.png" }],
  "usage": { "total_cost": 0.04 }
}
```

---

## Top Models by Price (1024×1024)

| Model | Price | Specialty |
|-------|-------|-----------|
| `google/gemini-3.1-flash-lite-image` | ~$0.001 | Cheapest! Multimodal |
| `black-forest-labs/flux.2-klein-4b` | ~$0.014 | Budget photorealism |
| `krea/krea-2-medium-turbo` | ~$0.015 | Fast, cheap, default fallback |
| `openai/gpt-image-2` | ~$0.04 | Top quality, text-in-image |
| `microsoft/mai-image-2.5` | ~$0.19 | Photorealism, 4K |

---

## Architecture

```
openrouter-image.ts
├── registerTool("generate_image")
│   ├── parameters: prompt, model, aspect_ratio, output_path
│   └── execute()
│       ├── Read config (model + ratio)
│       ├── Build image_config with explicit dimensions
│       ├── POST to OpenRouter API
│       ├── Download image (URL or base64)
│       ├── Save to images/ directory
│       └── Auto-persist model & ratio to config
├── registerCommand("set-image-model")
├── registerCommand("set-image-ratio")
└── registerCommand("list-image-models")
```

---

## Troubleshooting

### Image uses wrong model/ratio
1. Check config files:
   ```bash
   cat ~/.pi/agent/config/image-model.json
   cat ~/.pi/agent/config/image-aspect-ratio.json
   ```
2. If wrong, change via `/set-image-model` or `/set-image-ratio`

### API key error
Set `OPENROUTER_API_KEY`:
```bash
export OPENROUTER_API_KEY='sk-or-v1-...'
```

### Changes don't take effect
Restart your Pi session — extensions are loaded once at startup.

---

## License

MIT
