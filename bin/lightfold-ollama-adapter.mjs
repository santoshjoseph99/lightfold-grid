#!/usr/bin/env node

import readline from 'node:readline';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const model = valueFor('--model', process.env.LIGHTFOLD_GRID_OLLAMA_MODEL || 'gemma4-32k:latest');
const host = valueFor('--host', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const cwd = valueFor('--cwd', process.cwd());
const toolsEnabled = !args.includes('--no-tools');
const maxToolRounds = 20;
const commandTimeoutMs = 30_000;

const marker = (kind, summary, fields = {}, data) => `[[STARLIGHT-MSG]]${JSON.stringify({
  protocolVersion: 1,
  to: 'broker',
  kind,
  payload: { summary, ...(data ? { data } : {}) },
  attempt: 1,
  ...fields,
})}[[END]]`;
const parseRequest = (prompt) => {
  const match = prompt.match(/\[\[STARLIGHT-MSG\]\](.*?)\[\[END\]\]/s);
  if (!match) return undefined;
  try {
    const envelope = JSON.parse(match[1]);
    return envelope.kind === 'request' && envelope.taskId && envelope.messageId ? envelope : undefined;
  } catch {
    return undefined;
  }
};

// --- Tool definitions and execution ---

const safePath = (inputPath) => {
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(cwd, inputPath);
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..')) throw new Error(`Path outside workspace: ${inputPath}`);
  return resolved;
};

const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to the workspace root.' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file in the workspace, creating or overwriting it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          content: { type: 'string', description: 'The full file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the files and directories in a workspace path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path relative to the workspace root. Defaults to the workspace root.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the workspace and return stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to execute.' } },
        required: ['command'],
      },
    },
  },
];

const executeTool = (name, toolArgs) => {
  switch (name) {
    case 'read_file': {
      const path = safePath(toolArgs.path);
      if (!existsSync(path)) throw new Error(`File not found: ${toolArgs.path}`);
      return readFileSync(path, 'utf8');
    }
    case 'write_file': {
      const path = safePath(toolArgs.path);
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, toolArgs.content, 'utf8');
      return `Wrote ${toolArgs.content.length} bytes to ${toolArgs.path}`;
    }
    case 'list_dir': {
      const dirPath = toolArgs.path ? safePath(toolArgs.path) : cwd;
      if (!existsSync(dirPath)) throw new Error(`Directory not found: ${toolArgs.path || '.'}`);
      return readdirSync(dirPath).map((entry) => {
        const full = join(dirPath, entry);
        const isDir = statSync(full).isDirectory();
        return `${isDir ? 'd' : 'f'}  ${entry}`;
      }).join('\n');
    }
    case 'run_command': {
      try {
        const output = execSync(toolArgs.command, {
          cwd,
          timeout: commandTimeoutMs,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024,
        });
        return output || '(no output)';
      } catch (error) {
        const stdout = error.stdout || '';
        const stderr = error.stderr || '';
        return `Exit code ${error.status || '?'}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

// Parse text-based tool calls from model content (for models that put tool
// calls in the content field instead of using the native tool_calls API).
const parseTextToolCalls = (content) => {
  if (!content) return [];
  // Match bare JSON tool calls: {"name": "read_file", "arguments": {...}}
  const bareMatch = content.match(/\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/);
  if (bareMatch) {
    try {
      return [{ function: { name: bareMatch[1], arguments: JSON.parse(bareMatch[2]) } }];
    } catch { /* ignore parse error */ }
  }
  // Match code-fenced tool calls
  const fencedMatch = content.match(/```(?:json)?\s*\n?(\{\s*"name"\s*:\s*"\w+"[^`]*\})\s*\n?```/);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      if (parsed.name && parsed.arguments) {
        return [{ function: { name: parsed.name, arguments: parsed.arguments } }];
      }
    } catch { /* ignore parse error */ }
  }
  return [];
};

// --- Adapter lifecycle ---

process.stdout.write(`${marker('ready', `Ollama adapter ready: ${model}`)}\n`);
const heartbeat = setInterval(() => process.stdout.write(`${marker('heartbeat', 'Ollama adapter alive')}\n`), 15_000);
heartbeat.unref();

const input = readline.createInterface({ input: process.stdin, terminal: false });
let pending = Promise.resolve();
let pastedPrompt = '';
let taskBuffer = null;
const messages = [];

const chat = async (msgs) => {
  const body = { model, messages: msgs, stream: false };
  if (toolsEnabled) body.tools = toolDefs;
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Ollama API returned ${response.status}`);
  return response.json();
};

const submit = (raw) => {
  const prompt = raw.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '').trim();
  if (!prompt) return;
  pending = pending.then(async () => {
    const request = parseRequest(prompt);
    try {
      if (request) {
        process.stdout.write(`${marker('ack', 'accepted', {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        })}\n`);
      }
      const instruction = request?.payload?.instruction || prompt;
      messages.push({ role: 'user', content: instruction });

      let rounds = 0;
      let result;
      let content = '';
      while (rounds < maxToolRounds) {
        result = await chat(messages);
        // Strip thinking field — it's internal reasoning, not user-facing.
        content = result.message?.content || '';

        // Collect tool calls from both native API and text-based parsing.
        const nativeCalls = result.message?.tool_calls || [];
        const textCalls = nativeCalls.length > 0 ? [] : parseTextToolCalls(content);
        const allCalls = [...nativeCalls, ...textCalls];
        if (allCalls.length === 0) break;

        // Strip tool-call text from content so it doesn't leak to the user.
        if (textCalls.length > 0) content = '';

        messages.push({ role: 'assistant', content, ...(nativeCalls.length > 0 ? { tool_calls: nativeCalls } : {}) });

        for (const call of allCalls) {
          const name = call.function?.name;
          const toolArgs = call.function?.arguments || {};
          const parsedArgs = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
          let toolResult;
          try {
            toolResult = executeTool(name, parsedArgs);
          } catch (error) {
            toolResult = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
          const argSummary = JSON.stringify(parsedArgs).slice(0, 120);
          process.stdout.write(`\x1b[2m[tool] ${name}(${argSummary})\x1b[0m\n`);
          // Ollama expects tool results as role: "tool" messages.
          messages.push({ role: 'tool', content: String(toolResult) });
        }
        rounds++;
      }

      if (rounds >= maxToolRounds) {
        content = `${content}\n\n[Tool call limit reached after ${maxToolRounds} rounds]`;
      }

      messages.push({ role: 'assistant', content });
      const safeContent = content
        .replaceAll('[[STARLIGHT-MSG]]', '[[MODEL-MSG]]')
        .replaceAll('[[END]]', '[[MODEL-END]]');
      process.stdout.write(`${safeContent}\n`);
      if (request) {
        process.stdout.write(`${marker('result', safeContent || 'Ollama completed the request.', {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        }, {
          usage: {
            promptTokens: result.prompt_eval_count,
            completionTokens: result.eval_count,
            totalTokens: (result.prompt_eval_count || 0) + (result.eval_count || 0),
          },
        })}\n`);
      }
    } catch (error) {
      const summary = `Lightfold Ollama adapter error: ${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`${summary}\n`);
      if (request) {
        process.stdout.write(`${marker('error', summary, {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        })}\n`);
      }
    }
  });
};

// Detect broker-delivered [LIGHTFOLD GRID TASK] format and convert it into a
// synthetic [[STARLIGHT-MSG]] request envelope so the adapter can auto-ack
// and auto-result without the model needing to execute shell commands.
const trySubmitBrokerTask = (buffer) => {
  const taskIdMatch = buffer.match(/Task ID:\s*(\S+)/);
  const messageIdMatch = buffer.match(/Message ID:\s*(\S+)/);
  const instructionMatch = buffer.match(/Instruction:\n(.+)/);
  if (!taskIdMatch || !messageIdMatch || !instructionMatch) return false;
  const envelope = JSON.stringify({
    protocolVersion: 1,
    messageId: messageIdMatch[1],
    taskId: taskIdMatch[1],
    from: 'broker',
    to: 'adapter',
    kind: 'request',
    payload: { instruction: instructionMatch[1].trim() },
    attempt: 1,
  });
  submit(`[[STARLIGHT-MSG]]${envelope}[[END]]`);
  return true;
};

input.on('line', (line) => {
  if (pastedPrompt || line.includes('\u001b[200~')) {
    pastedPrompt += `${line}\n`;
    if (line.includes('\u001b[201~')) {
      submit(pastedPrompt);
      pastedPrompt = '';
    }
    return;
  }

  // Buffer broker-delivered task format until we have the instruction.
  if (line.includes('[LIGHTFOLD GRID TASK]')) {
    taskBuffer = '';
  }
  if (taskBuffer !== null) {
    taskBuffer += `${line}\n`;
    if (trySubmitBrokerTask(taskBuffer)) {
      taskBuffer = null;
    }
    return;
  }

  submit(line);
});

// Keep the process alive until pending work completes when stdin closes.
input.on('close', () => {
  pending.finally(() => {
    clearInterval(heartbeat);
    process.exit(0);
  });
});

const shutdown = () => {
  clearInterval(heartbeat);
  input.close();
  pending.finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
