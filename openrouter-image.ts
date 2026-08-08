import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";

interface ImageModel {
  id: string;
  name: string;
  pricing?: Record<string, string | number>;
  description?: string;
  aspect_ratios?: string[];
  resolutions?: string[];
}

// Persistent config: store selected image model
function getModelConfigPath(): string {
  return join(os.homedir(), ".pi", "agent", "config", "image-model.json");
}

function getRatioConfigPath(): string {
  return join(os.homedir(), ".pi", "agent", "config", "image-aspect-ratio.json");
}

function saveImageModel(modelId: string) {
  const configDir = dirname(getModelConfigPath());
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getModelConfigPath(), JSON.stringify({ modelId }, null, 2));
}

function loadImageModel(): string | undefined {
  const path = getModelConfigPath();
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf-8"));
      return cfg.modelId;
    } catch {}
  }
  return undefined;
}

// Persistent config: store selected aspect ratio
function saveImageAspectRatio(ratio: string) {
  const configDir = dirname(getRatioConfigPath());
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getRatioConfigPath(), JSON.stringify({ aspectRatio: ratio }, null, 2));
}

function loadImageAspectRatio(): string | undefined {
  const path = getRatioConfigPath();
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf-8"));
      return cfg.aspectRatio;
    } catch {}
  }
  return undefined;
}

export default async function (pi: ExtensionAPI) {
  // Fetch models dynamically from OpenRouter API
  let models: ImageModel[] = [];

  async function fetchModels(): Promise<ImageModel[]> {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/images/models");
      if (resp.ok) {
        const data = await resp.json();
        return (data.data || []).filter((m: any) => m.id);
      }
    } catch (e) {
      console.warn("[openrouter-image] Failed to fetch models:", e);
    }
    return [];
  }

  // Initial fetch
  models = await fetchModels();

  // Fallback hardcoded list
  const fallbackModels: ImageModel[] = [
    { id: "krea/krea-2-medium-turbo", name: "Krea 2 Medium Turbo", pricing: { image_output: "0.015/image" } },
    { id: "black-forest-labs/flux.2-klein-4b", name: "FLUX.2 Klein 4B", pricing: { image_output: "0.014/MP" } },
    { id: "sourceful/riverflow-v2-fast", name: "Riverflow V2 Fast", pricing: { image_output: "0.02/image" } },
    { id: "krea/krea-2-medium", name: "Krea 2 Medium", pricing: { image_output: "0.03/image" } },
    { id: "recraft/recraft-v4.1-utility", name: "Recraft V4.1 Utility", pricing: { image_output: "0.03/image" } },
    { id: "recraft/recraft-v4.1", name: "Recraft V4.1", pricing: { image_output: "0.03/image" } },
    { id: "bytedance-seed/seedream-4.5", name: "Seedream 4.5", pricing: { image_output: "0.03/image" } },
    { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", pricing: { image_output: "0.023/MP" } },
    { id: "google/gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", pricing: { image_output: "$0.001/image" } },
    { id: "openai/gpt-image-2", name: "GPT Image 2", pricing: { image_output: "0.04/image" } },
  ];

  // If API failed, use fallback
  if (models.length === 0) {
    models = fallbackModels;
  }

  // Get defaults: saved config > hardcoded default
  const savedModel = loadImageModel();
  const defaultModel = savedModel || "krea/krea-2-medium-turbo";
  const savedRatio = loadImageAspectRatio();
  const defaultRatio = savedRatio || "1:1";

  // Build model descriptions for tool parameter (top models only to keep schema small)
  const topModels = (models.length > 0 ? models : fallbackModels).slice(0, 15);
  const modelDescriptions = topModels
    .map(m => {
      const price = m.pricing?.image_output || m.pricing?.image_token || "N/A";
      return `  - \`${m.id}\` — ${price}`;
    })
    .join("\n");

  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description: "Generate an image from a text prompt using OpenRouter AI. Saves image to images/ directory. Requires OPENROUTER_API_KEY.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "Detailed text description of the image. Be specific for best results. Use English for most models.",
      }),
      model: Type.Optional(
        Type.String({
          description: `OpenRouter model ID. Default: ${defaultModel}. Use /set-image-model to change default.`,
        })
      ),
      aspect_ratio: Type.Optional(
        Type.String({
          description: `Aspect ratio: ${defaultRatio} (default), 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto. Persists until changed. Use /set-image-ratio to change interactively.`,
        })
      ),
      output_path: Type.Optional(
        Type.String({
          description: "Output file path relative to cwd. Default: images/generated_<timestamp>.png",
        })
      ),
    }),
    promptSnippet: "generate_image - Generate images from text via OpenRouter (40+ models)",
    promptGuidelines: [
      "Use generate_image for creating images from text descriptions",
      "Pass model= to generate_image to use a specific model",
      "Pass aspect_ratio= to generate_image — it persists until changed",
      "Use /set-image-model to change the default image model interactively",
      "Use /set-image-ratio to change the default aspect ratio interactively",
    ],
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "❌ OPENROUTER_API_KEY is not set.\n\nGet one at https://openrouter.ai/ and set it:\n  export OPENROUTER_API_KEY='sk-or-v1-...'" }],
          isError: true,
        };
      }

      // Model: param > saved config > hardcoded default
      const model = params.model || loadImageModel() || "krea/krea-2-medium-turbo";
      // If user specified a model param, save it as new default
      let modelChanged = false;
      if (params.model) {
        saveImageModel(params.model);
        modelChanged = true;
      }
      const prompt = params.prompt;

      // Aspect ratio: param > saved config > hardcoded default
      const aspectRatio = params.aspect_ratio || loadImageAspectRatio() || "1:1";
      // If user specified an aspect_ratio param, save it as new default
      if (params.aspect_ratio) {
        saveImageAspectRatio(params.aspect_ratio);
      }
      const aspectRatios: Record<string, { ratio: string; width: number; height: number }> = {
        "1:1":   { ratio: "1:1",   width: 1024, height: 1024 },
        "16:9":  { ratio: "16:9",  width: 1792, height: 1024 },
        "9:16":  { ratio: "9:16",  width: 1024, height: 1792 },
        "4:3":   { ratio: "4:3",   width: 1536, height: 1024 },
        "3:4":   { ratio: "3:4",   width: 1024, height: 1536 },
        "3:2":   { ratio: "3:2",   width: 1536, height: 1024 },
        "2:3":   { ratio: "2:3",   width: 1024, height: 1536 },
        "auto":  { ratio: "auto",  width: 1024, height: 1024 },
      };
      const arConfig = aspectRatios[aspectRatio] || aspectRatios["1:1"];

      const timestamp = Date.now();
      const outputPath = params.output_path
        ? join(ctx.cwd, params.output_path)
        : join(ctx.cwd, "images", `generated_${timestamp}.png`);

      mkdirSync(join(outputPath, ".."), { recursive: true });

      // Build image_config — include both aspect_ratio AND explicit dimensions
      // Different models respond better to different configs
      const imageConfig: Record<string, unknown> = {
        aspect_ratio: arConfig.ratio,
      };
      // Gemini and some models need explicit width/height
      if (!model.includes("google/") || aspectRatio !== "1:1") {
        imageConfig.width = arConfig.width;
        imageConfig.height = arConfig.height;
      }

      try {
        // aspect_ratio on top-level for GPT Image 2 / OpenAI models,
        // also inside image_config for other models
        const body: Record<string, unknown> = {
          model,
          prompt,
          aspect_ratio: arConfig.ratio,  // top-level for OpenAI gpt-image-2
          image_config: imageConfig,     // nested for other models
        };
        const response = await fetch("https://openrouter.ai/api/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "pi-agent",
            "X-Title": "pi-agent",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMsg = errorText;
          try {
            const errJson = JSON.parse(errorText);
            errorMsg = errJson?.error?.message || errJson?.error || errorText;
          } catch {}

          return {
            content: [{
              type: "text",
              text: `❌ Image generation failed (HTTP ${response.status}):\n${errorMsg}\n\nModel: ${model}\nPrompt: ${prompt}`
            }],
            isError: true,
          };
        }

        const data = await response.json();
        const imgData = data.data?.[0];
        const usage = data.usage || {};
        const cost = usage.total_cost ? `$${Number(usage.total_cost).toFixed(6)}` : "N/A";

        if (!imgData) {
          return {
            content: [{ type: "text", text: `❌ No image data in response.\nModel: ${model}\nResponse: ${JSON.stringify(data).substring(0, 500)}` }],
            isError: true,
          };
        }

        // Save image
        if (imgData.url) {
          const imgResp = await fetch(imgData.url);
          const buf = Buffer.from(await imgResp.arrayBuffer());
          writeFileSync(outputPath, buf);
        } else if (imgData.b64_json) {
          const buf = Buffer.from(imgData.b64_json, "base64");
          writeFileSync(outputPath, buf);
        }

        const relativePath = outputPath.replace(ctx.cwd + "/", "");
        const modelInfo = models.find(m => m.id === model);

        let result = `✅ Image generated!\n\n`;
        result += `📁 ${relativePath}\n`;
        result += `🤖 ${modelInfo?.name || model}\n`;
        result += `📐 ${aspectRatio} (${arConfig.width}×${arConfig.height})\n`;
        result += `💰 ${cost}\n`;
        if (imgData.url) result += `🔗 ${imgData.url}\n`;
        if (modelChanged) result += `⚙️  Model ${model} saved as new default\n`;
        result += `\nPrompt: "${prompt}"`;

        return {
          content: [{ type: "text", text: result }],
          details: {
            model,
            outputPath: relativePath,
            cost,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Error: ${err.message || err}\nModel: ${model}\nPrompt: ${prompt}` }],
          isError: true,
        };
      }
    },
  });

  // Command to select image model interactively (like /model for text models)
  pi.registerCommand("set-image-model", {
    description: "Select default image generation model from a menu",
    handler: async (_args, ctx) => {
      // Try to refresh from API
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/images/models");
        if (resp.ok) {
          const data = await resp.json();
          models = (data.data || []).filter((m: any) => m.id);
        }
      } catch {}

      if (models.length === 0) {
        models = fallbackModels;
      }

      // Sort: default first, then alphabetically by name
      const sorted = [...models].sort((a, b) => {
        const an = (a.name || a.id).toLowerCase();
        const bn = (b.name || b.id).toLowerCase();
        return an.localeCompare(bn);
      });

      // Build display options with model ID as prefix for matching
      // Format: "ModelName (price) [model/id]" — user picks the display, we extract the ID
      const currentModel = loadImageModel() || "krea/krea-2-medium-turbo";
      const optionToModel = new Map<string, ImageModel>();

      const options = sorted.map(m => {
        const price = m.pricing?.image_output || m.pricing?.image_token || "token-based";
        const current = (m.id === currentModel) ? " ◀️" : "";
        const display = `${m.name || m.id} (${price})${current}`;
        optionToModel.set(display, m);
        return display;
      });

      const choice = await ctx.ui.select(
        `Select image model (${currentModel})`,
        options
      );

      if (choice !== undefined) {
        const chosenModel = optionToModel.get(choice);
        if (chosenModel) {
          saveImageModel(chosenModel.id);
          ctx.ui.setStatus("image-gen", `🖼️ ${chosenModel.name || chosenModel.id} (${models.length} models)`);
          ctx.ui.notify(`🖼️ Image model set to: ${chosenModel.name || chosenModel.id}`, "info");
        }
      }
    },
  });

  // Command to set aspect ratio interactively
  pi.registerCommand("set-image-ratio", {
    description: "Select default image aspect ratio from a menu",
    handler: async (_args, ctx) => {
      const ratios = [
        { id: "1:1",  label: "1:1 (1024×1024) — štvorec" },
        { id: "16:9", label: "16:9 (1792×1024) — široký" },
        { id: "9:16", label: "9:16 (1024×1792) — portrét" },
        { id: "4:3",  label: "4:3 (1536×1024) — klasický" },
        { id: "3:4",  label: "3:4 (1024×1536) — klasický portrét" },
        { id: "3:2",  label: "3:2 (1536×1024) — foto" },
        { id: "2:3",  label: "2:3 (1024×1536) — foto portrét" },
        { id: "auto", label: "auto — nech na modeli" },
      ];

      const currentRatio = loadImageAspectRatio() || "1:1";
      const options = ratios.map(r => {
        const marker = r.id === currentRatio ? " ◀️" : "";
        return r.label + marker;
      });

      const choice = await ctx.ui.select(
        `Select aspect ratio (${currentRatio})`,
        options
      );

      if (choice !== undefined) {
        const idx = options.indexOf(choice);
        if (idx >= 0) {
          saveImageAspectRatio(ratios[idx].id);
          ctx.ui.setStatus("image-ratio", `📐 ${ratios[idx].label}`);
          ctx.ui.notify(`📐 Aspect ratio set to: ${ratios[idx].id}`, "info");
        }
      }
    },
  });

  // Command to list all models with pricing
  pi.registerCommand("list-image-models", {
    description: "List all available OpenRouter image generation models",
    handler: async (_args, ctx) => {
      // Try to refresh from API
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/images/models");
        if (resp.ok) {
          const data = await resp.json();
          models = (data.data || []).filter((m: any) => m.id);
        }
      } catch {}

      if (models.length === 0) {
        models = fallbackModels;
      }

      // Sort by price
      const sorted = [...models].sort((a, b) => {
        const pa = parseFloat(a.pricing?.image_output || a.pricing?.image_token || "999");
        const pb = parseFloat(b.pricing?.image_output || b.pricing?.image_token || "999");
        return pa - pb;
      });

      const currentModel = loadImageModel() || "krea/krea-2-medium-turbo";

      let output = `# OpenRouter Image Models (${sorted.length} total)\n\n`;
      output += `**Default:** \`${currentModel}\`\n\n`;
      output += `| # | Model | Price | Description |\n`;
      output += `|---|-------|-------|-------------|\n`;

      sorted.forEach((m, i) => {
        const price = m.pricing?.image_output || m.pricing?.image_token || "token-based";
        const desc = m.description
          ? m.description.substring(0, 80).replace(/\n/g, " ")
          : "";
        const marker = m.id === currentModel ? " ◀️" : "";
        output += `| ${i + 1} | \`${m.id}\`${marker} | ${price} | ${desc} |\n`;
      });

      output += `\n\n**Commands:**\n`;
      output += `- \`/set-image-model\` — Select default model interactively\n`;
      output += `- \`/list-image-models\` — This list\n`;

      ctx.ui.setWidget("image-models", output.split("\n"));
      ctx.ui.notify(`🖼️ ${sorted.length} image models available`, "info");
    },
  });
}
