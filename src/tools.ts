import type { ToolAnnouncement } from "./protocol.js";

export const mcpTools: ToolAnnouncement[] = [
  {
    name: "capture_scene",
    description:
      "Take a screenshot of the current 3D scene in the editor (not runtime). Use test_game to see runtime behavior instead.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "update_chat_title",
    description:
      "Update title for the current chat session. Do this once when it's clear what the chat is about.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: {
      idempotentHint: true,
    },
  },
  {
    name: "update_todos",
    description:
      "Update the todo list to track progress on multi-step tasks. Use this to show the user what you are working on.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: ["label", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    annotations: {
      idempotentHint: true,
    },
  },
  {
    name: "get_types",
    description:
      "Get TypeScript type definitions for game engine types. Use this to understand the structure of the project.",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "Align",
              "RgbColor",
              "RgbaColor",
              "Vector3",
              "PhysicsCollider",
              "PhysicsBodyType",
              "ShadowMapSize",
              "TransformComponent",
              "CameraComponent",
              "AudioComponent",
              "PhysicsComponent",
              "LightComponent",
              "MaterialTexture",
              "MaterialRef",
              "Material",
              "BackgroundComponent",
              "PostProcessComponent",
              "MeshComponent",
              "UiComponent",
              "VariableSet",
              "ScriptRef",
              "MouseButton",
              "InputState",
              "ComponentSet",
              "SceneObject",
              "Scene",
              "ScriptCommand",
              "ScriptEvent",
              "SceneObjectManager",
              "Entity",
              "ScriptCommandPayloads",
              "ScriptContext",
              "ScriptContextGlobal",
              "ScriptInit",
              "ScriptUpdate",
              "ScriptCustomEvent",
              "ScriptEventPayloads",
              "ScriptOnMessage",
            ],
          },
        },
      },
      required: ["names"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "search_assets",
    description:
      "Search external 3D model assets for import. Returns candidate IDs for import_asset.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "import_asset",
    description:
      "Import a searched asset into the current project using candidateId from search_assets.",
    inputSchema: {
      type: "object",
      properties: {
        candidateId: {
          type: "string",
          description: "Candidate ID returned from search_assets",
        },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "search_prefabs",
    description:
      "Search available prefabs (reusable packages of objects, scripts, materials, and assets) for import. Returns prefab IDs and descriptions for import_prefab. Use natural language or keywords; can include prefab type, purpose, style, or terms like ui, script, material, camera, physics, animation. Omit `query` to browse all available prefabs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          description:
            "Search query to find prefabs by name, description, or keywords. Omit to list all prefabs.",
          type: "string",
          minLength: 1,
        },
        limit: {
          description: "Max results returned. Defaults to 50.",
          type: "integer",
          minimum: 1,
          maximum: 200,
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "import_prefab",
    description:
      "Import a prefab into the current project using a prefabId from search_prefabs. Imports all prefab contents (objects, scripts, materials, assets, variables). Returns the IDs of the created entities so you can locate and modify them with edit_project (e.g. position, rename, attach to parent) without re-reading the project.",
    inputSchema: {
      type: "object",
      properties: {
        prefabId: {
          type: "string",
          description: "Prefab ID returned from search_prefabs",
        },
      },
      required: ["prefabId"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "search_project",
    description:
      "Search for text across project data — names, script code, IDs, variables, component fields. Returns matching entities with field paths and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          minLength: 1,
          description: "Search string.",
        },
        match: {
          description: "Defaults to 'substring'.",
          type: "string",
          enum: ["substring", "regex"],
        },
        caseSensitive: {
          description: "Defaults to false.",
          type: "boolean",
        },
        scope: {
          description:
            "Scope to search. sceneObjects = active scene, allObjects = all scenes. Omit to search all.",
          type: "string",
          enum: [
            "scripts",
            "assets",
            "materials",
            "scenes",
            "sceneObjects",
            "allObjects",
          ],
        },
        select: {
          description: "Defaults to 'all'.",
          type: "string",
          enum: ["first", "all", "count"],
        },
        limit: {
          description: "Max results returned.",
          type: "integer",
          minimum: 1,
          maximum: 200,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "read_project",
    description:
      "Execute JavaScript code to read project data. Code runs in sandbox with 'project' variable. Use 'return' to return the result.\n\nAvailable functions:\n- new SceneTraverser(scene) - traverse nested scene objects.\n  Methods: getById(id), findBy(fn), findFirst(fn), getAll(), query(mongoQuery), queryFirst(mongoQuery), count()\n  Example: new SceneTraverser(project.scenes[0]).query({type: 'mesh'})\n\nNote: Project data is nested (scenes -> children -> children). Use SceneTraverser to avoid manual recursion.\n",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          minLength: 1,
          description:
            "Short plain-language summary of what this read will do.",
        },
        code: {
          type: "string",
        },
      },
      required: ["description", "code"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "edit_project",
    description:
      "Execute JavaScript code to update the project. Code runs in a sandbox with 'project' variable. Mutate project directly. Use get_types to understand component structures before modifying them.\n\nAvailable functions:\n- generateId(name) - creates unique IDs for new objects/scripts\n- new SceneTraverser(scene) - traverse nested scene objects (same as read_project)\n",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          minLength: 1,
          description:
            "Short plain-language summary of what this update will do.",
        },
        code: {
          type: "string",
        },
      },
      required: ["description", "code"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "generate_object",
    description:
      "Generate a 3D object asset using Three.js code. The function signature must be: generateObject(THREE) returning THREE.Object3D. Only use built-in THREE classes (BufferGeometry, MeshStandardMaterial, Mesh, Group, etc). External imports, loaders, and textures are NOT available.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          description: "Name for the generated object asset",
        },
        code: {
          type: "string",
          description: "JavaScript code defining generateObject(THREE)",
        },
      },
      required: ["name", "code"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "test_game",
    description:
      "Run the game for a window of time and report what happened. Use this to verify runtime behavior — scripts executing, physics, animations. The game runs for `durationMs`; during that window console messages are collected and at the end a screenshot is taken. Each capture flag controls one piece of the result.",
    inputSchema: {
      type: "object",
      properties: {
        durationMs: {
          default: 1000,
          description:
            "How long the game runs. Logs are collected for this entire window.",
          type: "integer",
          minimum: 100,
          maximum: 10000,
        },
        screenshot: {
          default: true,
          description: "Capture a screenshot at the end of the run.",
          type: "boolean",
        },
        errors: {
          default: true,
          description: "Capture script errors emitted during the run.",
          type: "boolean",
        },
        logs: {
          default: false,
          description:
            "Capture info/warning console messages. Can be noisy for chatty scripts.",
          type: "boolean",
        },
      },
      required: ["durationMs", "screenshot", "errors", "logs"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question with a list of options to choose from. Use this when you need the user's input to proceed. For multiSelect, the answer is a JSON array of selected option strings.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          minLength: 1,
          description: "The question to ask the user",
        },
        options: {
          minItems: 2,
          type: "array",
          items: {
            type: "string",
          },
        },
        multiSelect: {
          type: "boolean",
        },
        allowOther: {
          description:
            "Adds an 'Other' option so the user can type a custom answer.",
          type: "boolean",
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
    annotations: {
      idempotentHint: false,
    },
  },
  {
    name: "get_instructions",
    description:
      "Get instructions for working with the game engine. Call this tool first before doing anything else.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
];
